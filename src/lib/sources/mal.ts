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
  /**
   * 棚グリッドは幅140px超の枠にaspect-ratio 2/3で描画するため、Retinaでは
   * 実効280px以上必要になる。MALのmediumは幅200px前後で拡大するとぼやけるため
   * largeを優先する(TMDBがw500を選んでいるのと粒度を揃える)。
   * Agreement Section 3(c)の保存禁止対象は個人情報とUGCで、画像は対象外(spec 3.4)
   */
  mainPicture: string | null;
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
    mainPicture: node.main_picture?.large ?? node.main_picture?.medium ?? null,
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
    mainPicture: node.main_picture?.large ?? node.main_picture?.medium ?? null,
    startDate: node.start_date ?? null,
    numEpisodes: null,
    averageEpisodeDurationSeconds: null,
    numVolumes: node.num_volumes ?? null,
    numChapters: node.num_chapters ?? null,
  };
}

/**
 * MALが403を返したことを表す。MALはレート制限を429ではなく403で返す(spec 3.4)。
 *
 * 【注意】403はレート制限とClient ID無効の**両方**で返る。両者はレスポンス
 * ボディにしか差が出ないため、判別材料としてbodyを保持する。ユーザーへの
 * 案内は同じ(時間をおいて再試行)でよいが、運用側では区別が必要:
 * Client IDが失効・停止すると全ユーザーの全リクエストが恒久的に403になり、
 * それを「混み合っています」とだけ表示していると障害に気づけない。
 */
export class MalRateLimitError extends Error {
  readonly body: string;
  constructor(body = "") {
    super("MAL returned 403 (rate limit or invalid client id)");
    this.name = "MalRateLimitError";
    this.body = body;
  }
}

/** MALが400を返したことを表す(クエリが短すぎる等、入力起因の失敗) */
export class MalBadRequestError extends Error {
  constructor() {
    super("MAL returned 400 (bad request)");
    this.name = "MalBadRequestError";
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
  if (res.status === 403) {
    // ボディを捨てるとレート制限とClient ID無効を切り分ける材料が永久に失われる。
    // 恒久障害(Client ID失効・MALによる停止)を検知できるよう必ずログに残す。
    // Agreement Section 18の監査要件(API利用記録を残す)にも資する
    const body = await res.text().catch(() => "");
    console.error("[mal] 403を受信しました", { path, body: body.slice(0, 500) });
    throw new MalRateLimitError(body);
  }
  if (res.status === 400) {
    // 短すぎるクエリ等。汎用エラーに落とすと「検索に失敗しました」になり、
    // ユーザーが何度リトライしても同じ結果になって詰む
    throw new MalBadRequestError();
  }
  if (!res.ok) {
    // 401(Client ID未設定・不正)もここに来る。403と同じく切り分け材料を残す
    console.error("[mal] リクエストが失敗しました", { path, status: res.status });
    throw new Error(`MAL request failed: ${res.status}`);
  }
  return res.json();
}

/**
 * APIに投げる前に弾く最小クエリ長。無駄なリクエストとレート消費を避ける。
 *
 * 【未検証】MALの公式ドキュメントに`q`の最小長の記載がなく、実際の閾値
 * (1文字なのか2文字なのか3文字なのか)は未確認。ここでは保守的に2を置いている。
 * 実データで確認できたら、確認日とともにこのコメントを更新すること。
 * なお閾値の推定が外れてMAL側で400になった場合も、MalBadRequestErrorとして
 * 「検索語が短い可能性」を伝えるメッセージに落ちるため、ユーザーが詰むことはない。
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

/**
 * source_records.raw_fieldsに保存する値を組み立てる。
 *
 * 「事実」フィールドのみを明示列挙するホワイトリスト(spec 3.4)。
 * spec 5.4が「強制手段はコードレビュー運用に頼らない」と定めている箇所なので、
 * catalog.ts側にインラインで書かずここに出してテストで守る。
 * フィールドを足すときは必ずテストが落ちるため、規約上の可否を再考する契機になる。
 */
export function buildRawFields(candidate: MalCandidate): Record<string, unknown> {
  return {
    title: candidate.title,
    titleJa: candidate.titleJa,
    mediaType: candidate.mediaType,
    startDate: candidate.startDate,
    numEpisodes: candidate.numEpisodes,
    averageEpisodeDurationSeconds: candidate.averageEpisodeDurationSeconds,
    numVolumes: candidate.numVolumes,
    numChapters: candidate.numChapters,
  };
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
