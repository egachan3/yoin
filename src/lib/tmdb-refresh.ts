// TMDBの6ヶ月キャッシュ上限対応(定期再取得Cron)の純粋ロジック。
// 参照: shelf-type-app-spec.md セクション5「TMDBの6ヶ月キャッシュ上限への対応」
//
// 状態遷移: source_records.deletion_status
//   active → (5.5ヶ月経過・再取得失敗) → ttl_pending → (6ヶ月経過まで再取得失敗) → deleted
//   ttl_pending → (再取得成功) → active
//
// D1/Cloudflare Queues固有のimportは持たない(テスト容易性のため)。

const DAY_SECONDS = 24 * 60 * 60;

/** 再取得を開始する基準日数(5.5ヶ月)。spec: 「5.5ヶ月時点で更新を開始」 */
export const REFETCH_START_DAYS = 165;
/** キャッシュのハード上限(6ヶ月)。TMDB API Terms of Use Section 1.Cの数値上限そのもの */
export const HARD_DEADLINE_DAYS = 180;
/** ジッター幅(±7日)。ローンチ時に一括取得した作品の再取得が特定週に集中しないようにする */
const JITTER_RANGE_DAYS = 7;

/**
 * source_record.idから決定的に-7〜+7日のジッターを算出する。
 * 乱数ではなくIDのハッシュを使うことで、同じレコードは常に同じ再取得予定日になる
 * (Cronを複数回実行しても予定日がぶれない)。
 */
export function jitterDays(sourceRecordId: string): number {
  let hash = 0;
  for (let i = 0; i < sourceRecordId.length; i++) {
    hash = (hash * 31 + sourceRecordId.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % (JITTER_RANGE_DAYS * 2 + 1)) - JITTER_RANGE_DAYS;
}

/** このレコードの再取得予定日時(UNIX秒)。ジッター込みで158〜172日目に分散する */
export function refetchDueAt(cachedAt: number, sourceRecordId: string): number {
  return cachedAt + (REFETCH_START_DAYS + jitterDays(sourceRecordId)) * DAY_SECONDS;
}

/** 6ヶ月のハード上限(UNIX秒)。ジッターは掛けない(規約上の数値そのものを守るため) */
export function hardDeadlineAt(cachedAt: number): number {
  return cachedAt + HARD_DEADLINE_DAYS * DAY_SECONDS;
}

/** activeなレコードが再取得の対象になったか(ジッター込みの予定日を過ぎたか) */
export function isDueForRefetch(cachedAt: number, sourceRecordId: string, now: number): boolean {
  return now >= refetchDueAt(cachedAt, sourceRecordId);
}

/** 6ヶ月のハード上限を過ぎたか(過ぎていれば、それ以上リトライせず削除する) */
export function isPastHardDeadline(cachedAt: number, now: number): boolean {
  return now >= hardDeadlineAt(cachedAt);
}

export type TmdbMediaType = "movie" | "tv";

/** source_records.source_idは`${mediaType}:${tmdbId}`形式(catalog.tsのfindOrCreateMovieCatalogEntity参照) */
export function parseTmdbSourceId(sourceId: string): { mediaType: TmdbMediaType; tmdbId: number } | null {
  const [mediaType, idPart] = sourceId.split(":");
  if (mediaType !== "movie" && mediaType !== "tv") return null;
  const tmdbId = Number(idPart);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null;
  return { mediaType, tmdbId };
}

/**
 * 6ヶ月の期限までに再取得できなかった作品の表示タイトル。
 * MAL削除アーキテクチャ(spec セクション10)と同じく、表示コンテンツを
 * catalog_entities 1箇所に集約しているため、ここを書き換えるだけで
 * 棚エントリ・リキャップの両方から自動的にプレースホルダ表示に切り替わる。
 */
export const TMDB_EXPIRED_PLACEHOLDER_TITLE = "取得元で確認できなくなった作品";
