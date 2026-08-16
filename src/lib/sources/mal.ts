// MyAnimeList 公式API v2クライアント。アニメ・マンガの検索・ID直接照会。
// 参照: shelf-type-app-spec.md セクション3.4「アニメ・マンガのデータソース選定」
//       セクション5.4「アプリ内検索のクエリ設計」
//       セクション10「推定消費時間のロジック」
//
// 【重要】永続化してよいのは「事実」フィールドのみ(spec 3.4)。
// synopsis / mean / rank / popularity / num_list_users は実質的にMALユーザーの
// 生成物(あらすじはユーザー投稿をモデレートしたもの、スコアは評価の集計値)であり、
// API Agreement Section 3(c)が禁じる「ユーザー生成コンテンツのサーバー側保存」に
// 該当し得る。そのため、このモジュールは型の時点でそれらのフィールドを持たない
// (Google Booksのimageのみ抽出と同じく、TypeScriptの型で構造的に持てなくする)。

import { z } from "zod";

const MAL_API_BASE = "https://api.myanimelist.net/v2";

export type MalMediaType = "anime" | "manga";

export interface MalCandidate {
  source: "mal";
  mediaType: MalMediaType;
  malId: number;
  /** MALの既定タイトル(多くはローマ字表記) */
  title: string;
  /** 日本語タイトル。alternative_titles.ja が取れた場合のみ */
  titleJa: string | null;
  mainPictureMedium: string | null;
  startDate: string | null;
  /** アニメのみ。放送中の作品では0になりうる(spec 10のNULL区別と同じ扱いが必要) */
  numEpisodes: number | null;
  /** アニメのみ。MALは**秒単位**で返すため estimated_duration_seconds と単位が一致する */
  averageEpisodeDurationSeconds: number | null;
  /** マンガのみ。連載中の作品では0になりうる */
  numVolumes: number | null;
  /** マンガのみ */
  numChapters: number | null;
}

// 検索・詳細で共通して要求するフィールド。事実フィールドのみを列挙する。
// (MAL APIはfieldsを明示しないと最小限しか返さない仕様)
const ANIME_FIELDS = "id,title,alternative_titles,main_picture,start_date,num_episodes,average_episode_duration";
const MANGA_FIELDS = "id,title,alternative_titles,main_picture,start_date,num_volumes,num_chapters";

const AlternativeTitlesSchema = z
  .object({
    ja: z.string().nullable().optional(),
  })
  // synonyms/en など他の値が来ても無視する(passthroughしない = 型に載せない)
  .optional();

const MainPictureSchema = z
  .object({
    medium: z.string().nullable().optional(),
    large: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const AnimeNodeSchema = z.object({
  id: z.number(),
  title: z.string(),
  alternative_titles: AlternativeTitlesSchema,
  main_picture: MainPictureSchema,
  start_date: z.string().nullable().optional(),
  num_episodes: z.number().nullable().optional(),
  average_episode_duration: z.number().nullable().optional(),
});

const MangaNodeSchema = z.object({
  id: z.number(),
  title: z.string(),
  alternative_titles: AlternativeTitlesSchema,
  main_picture: MainPictureSchema,
  start_date: z.string().nullable().optional(),
  num_volumes: z.number().nullable().optional(),
  num_chapters: z.number().nullable().optional(),
});

const AnimeListResponseSchema = z.object({
  data: z.array(z.object({ node: AnimeNodeSchema })),
});

const MangaListResponseSchema = z.object({
  data: z.array(z.object({ node: MangaNodeSchema })),
});

function toAnimeCandidate(node: z.infer<typeof AnimeNodeSchema>): MalCandidate {
  return {
    source: "mal",
    mediaType: "anime",
    malId: node.id,
    title: node.title,
    titleJa: node.alternative_titles?.ja ?? null,
    mainPictureMedium: node.main_picture?.medium ?? null,
    startDate: node.start_date ?? null,
    numEpisodes: node.num_episodes ?? null,
    averageEpisodeDurationSeconds: node.average_episode_duration ?? null,
    numVolumes: null,
    numChapters: null,
  };
}

function toMangaCandidate(node: z.infer<typeof MangaNodeSchema>): MalCandidate {
  return {
    source: "mal",
    mediaType: "manga",
    malId: node.id,
    title: node.title,
    titleJa: node.alternative_titles?.ja ?? null,
    mainPictureMedium: node.main_picture?.medium ?? null,
    startDate: node.start_date ?? null,
    numEpisodes: null,
    averageEpisodeDurationSeconds: null,
    numVolumes: node.num_volumes ?? null,
    numChapters: node.num_chapters ?? null,
  };
}

/** MALのレート制限超過を表す。MALは429ではなく403で返す(spec 3.4) */
export class MalRateLimitError extends Error {
  constructor() {
    super("MAL rate limit exceeded (403)");
    this.name = "MalRateLimitError";
  }
}

async function malFetch(path: string, params: Record<string, string>, clientId: string): Promise<unknown> {
  const url = new URL(`${MAL_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url.toString(), {
    headers: { "X-MAL-CLIENT-ID": clientId },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  // MALはレート制限を403(ドキュメント上「DoS detected」)で返す。TMDBと同じく429を
  // 見ていると取りこぼすため、403を専用のエラーとして区別する(spec 3.4)。
  // なおClient IDが無効な場合も401/403になり得るが、どちらもユーザーには
  // 「時間をおいて再試行」と案内するのが妥当なため呼び出し側では同じ扱いにする
  if (res.status === 403) {
    throw new MalRateLimitError();
  }
  if (!res.ok) {
    throw new Error(`MAL request failed: ${res.status}`);
  }
  return res.json();
}

/**
 * MALの検索は2文字以上を要求する(1文字だと400が返る)。
 * APIに投げる前に弾いて、無駄なリクエストとレート消費を避ける。
 */
export const MAL_MIN_QUERY_LENGTH = 2;

/** 1回の検索で取得する件数。「もっと探す」の次オフセット判定にも使う */
export const MAL_SEARCH_LIMIT = 20;

export async function searchAnime(query: string, clientId: string, offset = 0, limit = MAL_SEARCH_LIMIT): Promise<MalCandidate[]> {
  const json = await malFetch(
    "/anime",
    { q: query, fields: ANIME_FIELDS, limit: String(limit), offset: String(offset) },
    clientId,
  );
  if (json === null) return [];
  const parsed = AnimeListResponseSchema.parse(json);
  return parsed.data.map((item) => toAnimeCandidate(item.node));
}

export async function searchManga(query: string, clientId: string, offset = 0, limit = MAL_SEARCH_LIMIT): Promise<MalCandidate[]> {
  const json = await malFetch(
    "/manga",
    { q: query, fields: MANGA_FIELDS, limit: String(limit), offset: String(offset) },
    clientId,
  );
  if (json === null) return [];
  const parsed = MangaListResponseSchema.parse(json);
  return parsed.data.map((item) => toMangaCandidate(item.node));
}

/**
 * アニメ/マンガを同時には検索しない(spec 5.4の決定)。
 * MALのレート制限が約1req/秒のため、並列2本は即座に制限超過になる。
 * 呼び出し側(検索APIルート)がmediaTypeを指定して片方だけを叩く。
 */
export async function searchMal(
  mediaType: MalMediaType,
  query: string,
  clientId: string,
  offset = 0,
): Promise<MalCandidate[]> {
  return mediaType === "anime"
    ? searchAnime(query, clientId, offset)
    : searchManga(query, clientId, offset);
}

/**
 * クライアントが送ってきたmalId/mediaTypeを、MALへの再照会で検証する。
 * MALはID単体でのlookupをサポートするため、TMDBと同じく直接ID lookupが正
 * (booksのようなtitle経由の間接照会は不要)。
 */
export async function verifyAnimeById(malId: number, clientId: string): Promise<MalCandidate | null> {
  const json = await malFetch(`/anime/${malId}`, { fields: ANIME_FIELDS }, clientId);
  if (json === null) return null;
  const parsed = AnimeNodeSchema.safeParse(json);
  return parsed.success ? toAnimeCandidate(parsed.data) : null;
}

export async function verifyMangaById(malId: number, clientId: string): Promise<MalCandidate | null> {
  const json = await malFetch(`/manga/${malId}`, { fields: MANGA_FIELDS }, clientId);
  if (json === null) return null;
  const parsed = MangaNodeSchema.safeParse(json);
  return parsed.success ? toMangaCandidate(parsed.data) : null;
}

export async function verifyMalCandidate(
  mediaType: MalMediaType,
  malId: number,
  clientId: string,
): Promise<MalCandidate | null> {
  return mediaType === "anime" ? verifyAnimeById(malId, clientId) : verifyMangaById(malId, clientId);
}

/**
 * MALのアニメIDとマンガIDは別の採番空間で、同じ数値が別作品を指しうる。
 * source_records.UNIQUE(source, source_id)での衝突を避けるため、TMDBの
 * `movie:`/`tv:`プレフィックスと同じ方式でmediaTypeを含める。
 */
export function buildSourceId(candidate: Pick<MalCandidate, "mediaType" | "malId">): string {
  return `${candidate.mediaType}:${candidate.malId}`;
}

export function buildSourceUrl(candidate: Pick<MalCandidate, "mediaType" | "malId">): string {
  return `https://myanimelist.net/${candidate.mediaType}/${candidate.malId}`;
}

/** 日本語タイトルがあればそれを優先する(日本市場向けの差別化。spec 6章) */
export function displayTitle(candidate: Pick<MalCandidate, "title" | "titleJa">): string {
  return candidate.titleJa?.trim() || candidate.title;
}

/** マンガ1巻あたりの読了時間(分)。spec 10の決定値(クラウドソース的な相場観に基づく) */
export const MANGA_MINUTES_PER_VOLUME = 20;

export interface DurationEstimate {
  estimatedSeconds: number | null;
  pending: 0 | 1;
  rawValue: string | null;
  rawUnit: string | null;
}

/**
 * 推定消費時間を算出する(spec 10)。
 *
 * アニメ: average_episode_duration(秒) × num_episodes。
 *   MALは秒単位で返すためestimated_duration_secondsと単位が一致する。
 *   放送中の作品はnum_episodes=0になりうるため、その場合はduration_pending=1に倒す
 *   (「値が無い」ではなく「将来埋まり得る」区分。book/musicと同じ考え方)。
 * マンガ: num_volumes × 20分(spec 10の決定値)。
 *   連載中の作品はnum_volumes=0になりうるため同様にpendingへ。
 *   num_chaptersは巻数と換算基準が異なるためフォールバックには使わない
 *   (話数あたりの読了時間には根拠がなく、当て推量になるため)。
 *
 * ルートハンドラではなくここに置いているのは、Next.jsのroute.tsが
 * GET/POST等以外のexportを許さずユニットテストから参照できないため。
 * MAL固有の単位知識(秒単位である/巻数しか無い)を扱うロジックでもある。
 */
export function computeDuration(candidate: MalCandidate): DurationEstimate {
  if (candidate.mediaType === "anime") {
    const episodeDuration = candidate.averageEpisodeDurationSeconds;
    const numEpisodes = candidate.numEpisodes;
    if (!episodeDuration || episodeDuration <= 0 || !numEpisodes || numEpisodes <= 0) {
      return { estimatedSeconds: null, pending: 1, rawValue: null, rawUnit: null };
    }
    return {
      estimatedSeconds: episodeDuration * numEpisodes,
      pending: 0,
      rawValue: JSON.stringify({ averageEpisodeDurationSeconds: episodeDuration, numEpisodes }),
      rawUnit: "second_per_episode",
    };
  }

  const numVolumes = candidate.numVolumes;
  if (!numVolumes || numVolumes <= 0) {
    return { estimatedSeconds: null, pending: 1, rawValue: null, rawUnit: null };
  }
  return {
    estimatedSeconds: numVolumes * MANGA_MINUTES_PER_VOLUME * 60,
    pending: 0,
    rawValue: String(numVolumes),
    rawUnit: "volume",
  };
}
