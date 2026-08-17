// TMDB再取得Cronの実処理(consumer)。Queueから1件ずつ取り出し、TMDBへの再照会・
// DB更新・R2画像パージ・(必要なら)削除確定を行う。
// 参照: src/lib/tmdb-refresh.ts、shelf-type-app-spec.md セクション5

import { uuidv7 } from "uuidv7";
import type { Kysely } from "kysely";
import type { Database } from "@/db/schema";
import { createDb } from "@/db/client";
import { verifyMovieById, verifyTvById, buildImageUrl, type TmdbCandidate } from "@/lib/sources/tmdb";
import { parseTmdbSourceId, isPastHardDeadline, TMDB_EXPIRED_PLACEHOLDER_TITLE } from "@/lib/tmdb-refresh";
import { buildR2Key } from "@/lib/image-proxy";
import type { TmdbRefreshMessage } from "./tmdb-refresh-producer";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function purgeImage(r2: R2Bucket, catalogEntityId: string): Promise<void> {
  // 書影が更新された可能性・6ヶ月上限で表示コンテンツを消す必要がある場合、
  // どちらのケースでもR2側のキャッシュを残したままにしてはならない
  // (spec: 「CDN/Cache APIのパージも同じ削除ジョブに含める」)。
  // 削除後は既存の遅延補充の仕組み(image-proxy.ts)が次回アクセス時に
  // 改めて取得し直すため、ここでは破棄するだけでよい
  try {
    await r2.delete(buildR2Key(catalogEntityId, "grid"));
  } catch (err) {
    console.error("[tmdb-refresh-consumer] R2画像のパージに失敗しました", catalogEntityId, err);
  }
}

interface RefreshableRecord {
  id: string;
  catalog_entity_id: string;
  source_id: string;
  cached_at: number;
}

/**
 * 再取得成功時: catalog_entities/source_recordsの各フィールドを単一UPDATE文で
 * まとめて反映する(spec: 「複数フィールドの更新は単一UPDATE文で一括反映する」)。
 * 2つのテーブルへの書き込みはd1.batch()で原子化する(catalog.tsの既存パターンを踏襲)。
 */
async function applySuccessfulRefresh(
  db: Kysely<Database>,
  d1: D1Database,
  r2: R2Bucket,
  record: RefreshableRecord,
  candidate: TmdbCandidate,
  now: number,
): Promise<void> {
  const imageUrl = candidate.posterPath ? buildImageUrl(candidate.posterPath) : null;

  const updateCatalog = db
    .updateTable("catalog_entities")
    .set({ title: candidate.title, primary_image_ref: imageUrl, updated_at: now })
    .where("id", "=", record.catalog_entity_id)
    .compile();

  const updateSourceRecord = db
    .updateTable("source_records")
    .set({
      raw_fields: JSON.stringify({
        title: candidate.title,
        mediaType: candidate.mediaType,
        releaseDate: candidate.releaseDate,
        runtimeMinutes: candidate.runtimeMinutes,
        episodeRuntimeMinutes: candidate.episodeRuntimeMinutes,
        numberOfEpisodes: candidate.numberOfEpisodes,
      }),
      // 過去にttl_pending(再取得失敗中)だった場合も、成功した以上activeへ戻す
      deletion_status: "active",
      cached_at: now,
      updated_at: now,
    })
    .where("id", "=", record.id)
    .compile();

  try {
    await d1.batch([
      d1.prepare(updateCatalog.sql).bind(...updateCatalog.parameters),
      d1.prepare(updateSourceRecord.sql).bind(...updateSourceRecord.parameters),
    ]);
  } catch (err) {
    console.error("[tmdb-refresh-consumer] 再取得結果の反映に失敗しました", record.id, err);
    return;
  }

  await purgeImage(r2, record.catalog_entity_id);
}

/**
 * 6ヶ月の期限までに再取得できなかった場合の削除確定処理。
 * 棚エントリ自体は残すが、表示コンテンツ(タイトル・画像)をプレースホルダに
 * 切り替える(2026-08-17、ユーザーと確認済み)。MAL削除アーキテクチャ
 * (spec セクション10)と同じく、catalog_entities 1箇所を書き換えるだけで
 * 棚一覧・リキャップの両方から自動的に反映される。
 */
async function finalizeDeletion(
  db: Kysely<Database>,
  d1: D1Database,
  r2: R2Bucket,
  record: RefreshableRecord,
  now: number,
): Promise<void> {
  const updateCatalog = db
    .updateTable("catalog_entities")
    .set({ title: TMDB_EXPIRED_PLACEHOLDER_TITLE, primary_image_ref: null, updated_at: now })
    .where("id", "=", record.catalog_entity_id)
    .compile();

  const updateSourceRecord = db
    .updateTable("source_records")
    .set({ deletion_status: "deleted", updated_at: now })
    .where("id", "=", record.id)
    .compile();

  try {
    await d1.batch([
      d1.prepare(updateCatalog.sql).bind(...updateCatalog.parameters),
      d1.prepare(updateSourceRecord.sql).bind(...updateSourceRecord.parameters),
    ]);
  } catch (err) {
    console.error("[tmdb-refresh-consumer] 削除確定の反映に失敗しました", record.id, err);
    return;
  }

  try {
    await db
      .insertInto("deletion_log")
      .values({
        id: uuidv7(),
        source: "tmdb",
        source_id: record.source_id,
        reason: "6ヶ月キャッシュ上限までに再取得できなかったため削除",
        reference: null,
        deleted_at: now,
      })
      .execute();
  } catch (err) {
    // 監査ログの書き込み失敗自体はユーザー体験に影響しないため、握りつぶして継続する
    console.error("[tmdb-refresh-consumer] deletion_logの記録に失敗しました", record.id, err);
  }

  await purgeImage(r2, record.catalog_entity_id);
}

export interface TmdbRefreshEnv {
  DB: D1Database;
  IMAGE_CACHE: R2Bucket;
  TMDB_API_KEY?: string;
}

export async function processTmdbRefreshMessage(env: TmdbRefreshEnv, message: TmdbRefreshMessage): Promise<void> {
  if (!env.TMDB_API_KEY) {
    console.error("[tmdb-refresh-consumer] TMDB_API_KEYが未設定のため再取得をスキップします");
    return;
  }

  const db = createDb(env.DB);
  const record = await db
    .selectFrom("source_records")
    .select(["id", "catalog_entity_id", "source_id", "cached_at", "deletion_status"])
    .where("id", "=", message.sourceRecordId)
    .where("source", "=", "tmdb")
    .executeTakeFirst();

  // 既に削除確定済み、または(レース等で)行自体が無ければ何もしない
  if (!record || record.deletion_status === "deleted" || record.cached_at === null) return;

  const parsed = parseTmdbSourceId(record.source_id);
  if (!parsed) {
    console.error("[tmdb-refresh-consumer] source_idのパースに失敗しました", record.source_id);
    return;
  }

  let candidate: TmdbCandidate | null;
  try {
    candidate =
      parsed.mediaType === "movie"
        ? await verifyMovieById(parsed.tmdbId, env.TMDB_API_KEY)
        : await verifyTvById(parsed.tmdbId, env.TMDB_API_KEY);
  } catch (err) {
    console.error("[tmdb-refresh-consumer] TMDBへの再照会に失敗しました", record.id, err);
    candidate = null;
  }

  const now = nowSeconds();
  const refreshableRecord: RefreshableRecord = {
    id: record.id,
    catalog_entity_id: record.catalog_entity_id,
    source_id: record.source_id,
    cached_at: record.cached_at,
  };

  if (candidate) {
    await applySuccessfulRefresh(db, env.DB, env.IMAGE_CACHE, refreshableRecord, candidate, now);
    return;
  }

  // 失敗(通信エラー、またはTMDB側が404=作品が削除された)
  if (isPastHardDeadline(record.cached_at, now)) {
    await finalizeDeletion(db, env.DB, env.IMAGE_CACHE, refreshableRecord, now);
  } else if (record.deletion_status !== "ttl_pending") {
    await db
      .updateTable("source_records")
      .set({ deletion_status: "ttl_pending", updated_at: now })
      .where("id", "=", record.id)
      .execute();
  }
  // deletion_statusが既にttl_pendingなら、cached_atは更新せず次回Cronの
  // 毎日リトライに任せる(cached_atを更新するとhardDeadlineの計算基準が
  // ずれてしまうため、あくまで「最初にactiveだった時点」を基準に保つ)
}

export async function processTmdbRefreshBatch(batch: MessageBatch<TmdbRefreshMessage>, env: TmdbRefreshEnv): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await processTmdbRefreshMessage(env, msg.body);
    } catch (err) {
      console.error("[tmdb-refresh-consumer] メッセージ処理中に予期しないエラー", msg.body, err);
    } finally {
      // 独自のリトライ機構(Cronによる翌日以降の再enqueue)を使うため、
      // Cloudflare Queue自体のリトライ機構には乗らず常にackする
      msg.ack();
    }
  }
}
