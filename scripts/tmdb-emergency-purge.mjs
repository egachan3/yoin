#!/usr/bin/env node
// TMDBライセンス終了時等の緊急パージ用スクリプト。
//
// TMDB API Terms of Use Section 1.D「ライセンス終了時は即座に削除」("immediately")は
// 通常のTTL経由の削除フロー(src/cron/tmdb-refresh-*.ts、6ヶ月の期限までリトライ猶予あり)
// より厳しい要求のため、TMDB由来のcatalog_entities/source_records全件を手動で
// 即時パージできる別経路として用意した(shelf-type-app-spec.md セクション5参照)。
//
// 管理画面等のUIは無く、開発者が必要な時にローカルから直接実行する運用にしている。
// 理由: 現時点でUGCの公開経路(公開棚ページ・フォロー・ブロック機能)自体が
// まだ存在せず、Apple App Store審査ガイドライン1.2対応の管理画面はそちらの
// 機能実装時にまとめて作る方針のため(2026-08-17、ユーザーと確認済み)。
// 将来その管理画面を作る際は、このスクリプトの中身(パージのロジック)を
// 秘密トークンではなく既存ログイン+管理者フラグで保護したAPIルートに
// 移植する想定(ローカルスクリプトのまま画面は作れないため)。
//
// 対象は本番(--remote)のD1・R2のみ。ローカル開発用のデータには触れない。
//
// 使い方:
//   node scripts/tmdb-emergency-purge.mjs           # ドライラン(対象を表示するだけ、何も変更しない)
//   node scripts/tmdb-emergency-purge.mjs --execute  # 実際にパージを実行(対話確認あり)

import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { uuidv7 } from "uuidv7";

const DATABASE = "yoin-db";
const BUCKET = "yoin-image-cache";

// src/lib/tmdb-refresh.tsのTMDB_EXPIRED_PLACEHOLDER_TITLEと同じ値。
// このスクリプトはNode単体で実行するため(tsx等の追加依存を持ち込まないよう
// あえてプレーンな.mjsにしている)、値の同期はscripts/tmdb-emergency-purge.test.tsで保証する
export const PLACEHOLDER_TITLE = "取得元で確認できなくなった作品";

/** SQL文字列リテラル用にシングルクオートをエスケープする */
export function sqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 対象1件分の削除確定SQL(BEGIN〜COMMITの5文)を組み立てる。
 *
 * 【レビュー指摘への対応】以前は全対象をまとめて1つのSQLファイルに連結し
 * 一度のwrangler呼び出しで実行していたが、D1公式ドキュメントによれば大きな
 * ファイルは内部で複数バッチに分割され、各バッチが個別にコミットされるため
 * ファイル全体としての原子性は保証されない。対象ごとに個別のBEGIN/COMMITで
 * 包み、対象ごとに個別のwrangler呼び出しにすることで、(1)各対象の3更新は
 * 確実に原子的に反映され、(2)ある対象の失敗が他の対象の成功済みパージを
 * 巻き込まない(1件ずつ確定していく)、の両方を満たすようにした。
 *
 * source_recordsのUPDATEにdeletion_status != 'deleted'のガードを付けているのは
 * tmdb-refresh-consumer.tsのfinalizeDeletionと同じ理由(再実行時にdeletion_logへ
 * 重複記録しないため)。
 */
export function buildPurgeStatements(target, now) {
  return [
    "BEGIN TRANSACTION;",
    `UPDATE catalog_entities SET title = ${sqlString(PLACEHOLDER_TITLE)}, primary_image_ref = NULL, updated_at = ${now} WHERE id = ${sqlString(target.catalog_entity_id)};`,
    `UPDATE source_records SET deletion_status = 'deleted', updated_at = ${now} WHERE id = ${sqlString(target.source_record_id)} AND deletion_status != 'deleted';`,
    `INSERT INTO deletion_log (id, source, source_id, reason, reference, deleted_at) VALUES (${sqlString(uuidv7())}, 'tmdb', ${sqlString(target.source_id)}, ${sqlString("緊急パージスイッチによる手動即時削除")}, NULL, ${now});`,
    "COMMIT;",
  ];
}

function runD1Json(command) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DATABASE, "--remote", "--json", "--command", command],
    { encoding: "utf-8" },
  );
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

/** 1件分のSQL(数文程度)を一時ファイル経由で実行する。ファイルは毎回ユニークな名前にする */
function runD1File(sql) {
  const tmpPath = join(tmpdir(), `tmdb-emergency-purge-${randomUUID()}.sql`);
  writeFileSync(tmpPath, sql, "utf-8");
  try {
    execFileSync("npx", ["wrangler", "d1", "execute", DATABASE, "--remote", "--file", tmpPath], {
      encoding: "utf-8",
      stdio: "inherit",
    });
  } finally {
    unlinkSync(tmpPath);
  }
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim() === "yes";
}

async function main() {
  const execute = process.argv.includes("--execute");

  console.log("本番(--remote)のD1・R2からTMDB由来データを検索します...\n");

  // catalog_entitiesを内部結合ではなく左外部結合にする(レビュー指摘)。
  // 内部結合だと、対応するcatalog_entities行が何らかの理由で欠けている
  // 孤立したsource_records行がパージ対象から漏れてしまう。「TMDB由来
  // データ全件パージ」という目的上、そうした行も対象に含める
  const targets = runD1Json(
    "SELECT sr.id as source_record_id, sr.source_id, sr.catalog_entity_id, ce.title as title " +
      "FROM source_records sr LEFT JOIN catalog_entities ce ON ce.id = sr.catalog_entity_id " +
      "WHERE sr.source = 'tmdb' AND sr.deletion_status != 'deleted'",
  );

  if (targets.length === 0) {
    console.log("対象のTMDBデータはありません(既に全てパージ済み、またはTMDBデータが1件もない)。");
    return;
  }

  console.log(`対象: ${targets.length}件`);
  for (const t of targets) {
    console.log(`  - ${t.title ?? "(タイトル取得不可・catalog_entities行が見つからない)"} (catalog_entity_id=${t.catalog_entity_id}, source_id=${t.source_id})`);
  }

  if (!execute) {
    console.log("\nドライランのため何も変更していません。実行するには --execute を付けて再実行してください。");
    return;
  }

  console.log("\n【警告】この操作は取り消せません。棚エントリは残りますが、上記作品のタイトル・画像は");
  console.log("プレースホルダに置き換わり、元のTMDBデータは復元できません。");
  const ok = await confirm(`本当に${targets.length}件をパージしますか? "yes" と入力してください: `);
  if (!ok) {
    console.log("中止しました。何も変更していません。");
    return;
  }

  console.log("\n1件ずつパージしています...");
  const now = Math.floor(Date.now() / 1000);
  const failedDbTargets = [];
  const failedR2Targets = [];

  for (const t of targets) {
    try {
      const sql = buildPurgeStatements(t, now).join("\n");
      runD1File(sql);
    } catch (err) {
      console.error(`  - DB更新に失敗(catalog_entity_id=${t.catalog_entity_id}): ${err.message}`);
      failedDbTargets.push(t);
      // このtargetのR2パージは、DB側が中途半端(BEGIN〜COMMITで原子的なので
      // 実際には未反映のはず)な可能性があるため試みない。次回の再実行に委ねる
      continue;
    }

    try {
      execFileSync(
        "npx",
        ["wrangler", "r2", "object", "delete", `${BUCKET}/${t.catalog_entity_id}/grid`, "--remote"],
        { encoding: "utf-8" },
      );
    } catch (err) {
      // 画像が元々存在しない(未取得)場合もここに来るため、失敗しても処理は続行する。
      // ただし最後に件数として明示するため記録しておく(レビュー指摘:
      // 「対象なし」と「本物の障害」が区別できないログでは危険)
      failedR2Targets.push({ target: t, message: err.message });
    }
  }

  console.log(`\nDB更新: ${targets.length - failedDbTargets.length}/${targets.length}件成功`);
  if (failedDbTargets.length > 0) {
    console.log(`  失敗: ${failedDbTargets.map((t) => t.catalog_entity_id).join(", ")}`);
    console.log("  → 再度このスクリプトを実行すれば、失敗した対象だけ再度候補に挙がります。");
  }

  const r2AttemptCount = targets.length - failedDbTargets.length;
  console.log(`R2画像パージ: ${r2AttemptCount - failedR2Targets.length}/${r2AttemptCount}件成功(失敗は画像が元々無い場合を含む)`);
  if (failedR2Targets.length > 0) {
    for (const { target, message } of failedR2Targets) {
      console.log(`  - catalog_entity_id=${target.catalog_entity_id}: ${message}`);
    }
  }
}

// vitestからimportされた際にmain()が実行されないようにする
// (このファイル自体がエントリポイントとして実行された場合のみ動く)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
