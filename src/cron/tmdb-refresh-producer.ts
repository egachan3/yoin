// TMDB再取得Cronの起点(producer)。source_recordsから再取得対象を探し、Queueに積む。
// 参照: src/lib/tmdb-refresh.ts

import type { Kysely } from "kysely";
import type { Database } from "@/db/schema";
import { createDb } from "@/db/client";
import { isDueForRefetch } from "@/lib/tmdb-refresh";

export interface TmdbRefreshMessage {
  sourceRecordId: string;
}

// 1回のCron実行で処理する上限。現状のデータ量では十分すぎる余裕があるが、
// 将来データが増えてもCron Trigger(1時間以上間隔で15分のCPU制限)を
// 超えないよう安全弁として設ける
const CANDIDATE_LIMIT = 500;

// Cloudflare QueuesのsendBatch()は1回の呼び出しにつき最大100件までという
// 制約がある(公式ドキュメント)。CANDIDATE_LIMITを超えて溜まった場合に
// 送信自体が失敗しないよう、100件ずつに分割して複数回送信する(レビュー指摘)
const QUEUE_SEND_BATCH_MAX = 100;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

interface RefreshCandidate {
  id: string;
  cached_at: number | null;
  deletion_status: "active" | "ttl_pending" | "deleted";
}

/**
 * 再取得候補をCANDIDATE_LIMIT件まで取得する。ORDER BYを付けずLIMITだけを
 * 掛けると、候補が上限を超えたときにどの行が返るかがSQLiteの内部順序任せに
 * なり、期限が迫っているレコードが選ばれずハード期限を超過しうる(レビュー指摘)。
 * そのため2段階に分ける:
 * 1. ttl_pending(既に再取得に失敗し猶予期間中。最優先)を全件(上限まで)取得
 * 2. 残り枠をactive(cached_atが古い=期限が近い順)で埋める
 */
async function fetchRefreshCandidates(db: Kysely<Database>): Promise<RefreshCandidate[]> {
  const ttlPending = await db
    .selectFrom("source_records")
    .select(["id", "cached_at", "deletion_status"])
    .where("source", "=", "tmdb")
    .where("deletion_status", "=", "ttl_pending")
    .where("cached_at", "is not", null)
    .limit(CANDIDATE_LIMIT)
    .execute();

  const remaining = CANDIDATE_LIMIT - ttlPending.length;
  if (remaining <= 0) return ttlPending;

  const active = await db
    .selectFrom("source_records")
    .select(["id", "cached_at", "deletion_status"])
    .where("source", "=", "tmdb")
    .where("deletion_status", "=", "active")
    .where("cached_at", "is not", null)
    .orderBy("cached_at", "asc")
    .limit(remaining)
    .execute();

  return [...ttlPending, ...active];
}

/**
 * source_records(source: tmdb)のうち再取得が必要な行を探し、Queueへ積む。
 * - deletion_status: active → ジッター込みの予定日(5.5ヶ月+-7日)を過ぎていれば対象
 * - deletion_status: ttl_pending → 6ヶ月の期限までは毎日リトライ対象(ジッターなし)
 * - deletion_status: deleted → 対象外(既に確定済み)
 *
 * 実際のTMDB再照会・DB更新はconsumer側(tmdb-refresh-consumer.ts)が行う。
 * ここではdue判定とenqueueのみに絞ることで、Cron Trigger自体のCPU時間を
 * 短く保つ(D1 SELECT+Queue送信のみ)。
 */
export async function enqueueDueTmdbRefreshes(
  db: Kysely<Database>,
  queue: Queue<TmdbRefreshMessage>,
  now: number,
): Promise<number> {
  const candidates = await fetchRefreshCandidates(db);

  const due = candidates.filter((c) => {
    if (c.cached_at === null) return false;
    if (c.deletion_status === "ttl_pending") return true;
    return isDueForRefetch(c.cached_at, c.id, now);
  });

  if (due.length === 0) return 0;

  for (const group of chunk(due, QUEUE_SEND_BATCH_MAX)) {
    await queue.sendBatch(group.map((c) => ({ body: { sourceRecordId: c.id } })));
  }
  return due.length;
}

export async function runTmdbRefreshProducer(env: { DB: D1Database; TMDB_REFRESH_QUEUE: Queue<TmdbRefreshMessage> }): Promise<void> {
  const db = createDb(env.DB);
  const now = Math.floor(Date.now() / 1000);
  try {
    const count = await enqueueDueTmdbRefreshes(db, env.TMDB_REFRESH_QUEUE, now);
    console.log(`[tmdb-refresh-producer] ${count}件をキューに送信しました`);
  } catch (err) {
    // Cron自体を落とさない。次回実行で再度候補を拾い直せるため、
    // ここで例外を握りつぶしても再取得の機会は失われない
    console.error("[tmdb-refresh-producer] 候補の検索・送信に失敗しました", err);
  }
}
