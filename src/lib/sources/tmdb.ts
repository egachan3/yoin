// TMDB APIクライアント。映画・ドラマの検索・ID直接照会。
// 参照: shelf-type-app-spec.md セクション3.3「映画・ドラマのデータソース選定」
//       セクション5.4「アプリ内検索のクエリ設計」

import { z } from "zod";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export type MediaType = "movie" | "tv";

export interface TmdbCandidate {
  source: "tmdb";
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
  /** 映画のみ(分)。/movie/{id}の詳細取得(verify時)でのみ取れる */
  runtimeMinutes: number | null;
  /** ドラマのみ(分)。/tv/{id}の詳細取得(verify時)でのみ取れる */
  episodeRuntimeMinutes: number | null;
  /** ドラマのみ。放送中は0になりうる(MAL num_episodesと同じ注意点) */
  numberOfEpisodes: number | null;
}

const MovieSearchItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  poster_path: z.string().nullable().optional(),
  release_date: z.string().nullable().optional(),
});

const TvSearchItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  poster_path: z.string().nullable().optional(),
  first_air_date: z.string().nullable().optional(),
});

const MovieSearchResponseSchema = z.object({
  results: z.array(MovieSearchItemSchema),
});

const TvSearchResponseSchema = z.object({
  results: z.array(TvSearchItemSchema),
});

const MovieDetailSchema = z.object({
  id: z.number(),
  title: z.string(),
  poster_path: z.string().nullable().optional(),
  release_date: z.string().nullable().optional(),
  runtime: z.number().nullable().optional(),
});

const TvDetailSchema = z.object({
  id: z.number(),
  name: z.string(),
  poster_path: z.string().nullable().optional(),
  first_air_date: z.string().nullable().optional(),
  // TMDBが将来nullを返すケースに備えnullableも許容する(レビュー指摘)。
  // ここでパース自体を失敗させると、本来はduration計算だけをpending扱いに
  // すべき場面がnot_foundエラーに化けてしまう
  episode_run_time: z.array(z.number()).nullable().optional(),
  number_of_episodes: z.number().nullable().optional(),
});

function toMovieCandidate(item: z.infer<typeof MovieSearchItemSchema> | z.infer<typeof MovieDetailSchema>): TmdbCandidate {
  const runtime = "runtime" in item ? (item.runtime ?? null) : null;
  return {
    source: "tmdb",
    mediaType: "movie",
    tmdbId: item.id,
    title: item.title,
    posterPath: item.poster_path ?? null,
    releaseDate: item.release_date ?? null,
    runtimeMinutes: runtime,
    episodeRuntimeMinutes: null,
    numberOfEpisodes: null,
  };
}

function toTvCandidate(item: z.infer<typeof TvSearchItemSchema> | z.infer<typeof TvDetailSchema>): TmdbCandidate {
  const episodeRuntime = "episode_run_time" in item ? (item.episode_run_time?.[0] ?? null) : null;
  const numberOfEpisodes = "number_of_episodes" in item ? (item.number_of_episodes ?? null) : null;
  return {
    source: "tmdb",
    mediaType: "tv",
    tmdbId: item.id,
    title: item.name,
    posterPath: item.poster_path ?? null,
    releaseDate: item.first_air_date ?? null,
    runtimeMinutes: null,
    episodeRuntimeMinutes: episodeRuntime,
    numberOfEpisodes,
  };
}

async function tmdbFetch(path: string, params: Record<string, string>, apiKey: string): Promise<unknown> {
  const url = new URL(`${TMDB_API_BASE}${path}`);
  url.searchParams.set("language", "ja-JP");
  url.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`TMDB request failed: ${res.status}`);
  }
  return res.json();
}

export async function searchMovies(query: string, apiKey: string, page = 1): Promise<TmdbCandidate[]> {
  const json = await tmdbFetch("/search/movie", { query, page: String(page) }, apiKey);
  const parsed = MovieSearchResponseSchema.parse(json);
  return parsed.results.map(toMovieCandidate);
}

export async function searchTv(query: string, apiKey: string, page = 1): Promise<TmdbCandidate[]> {
  const json = await tmdbFetch("/search/tv", { query, page: String(page) }, apiKey);
  const parsed = TvSearchResponseSchema.parse(json);
  return parsed.results.map(toTvCandidate);
}

/**
 * 映画とドラマを同時に検索し、統合した結果を返す。
 * TMDBの/search/multiは俳優等の人物検索結果も混ざりノイズになるため、
 * 個別のエンドポイントを並行で叩いて統合する(spec 5.4決定)。
 */
export async function searchMoviesAndTv(query: string, apiKey: string, page = 1): Promise<TmdbCandidate[]> {
  // Promise.allとせず個別にsettleさせる。片方(例: /search/tv)だけが一時的な
  // エラー/タイムアウトになっても、成功しているもう片方の結果まで巻き込んで
  // 検索全体を失敗させないため(レビュー指摘)。両方失敗した場合のみ例外を
  // 投げ、呼び出し側(検索APIルート)が502として扱えるようにする
  const [movieResult, tvResult] = await Promise.allSettled([
    searchMovies(query, apiKey, page),
    searchTv(query, apiKey, page),
  ]);

  if (movieResult.status === "rejected" && tvResult.status === "rejected") {
    throw movieResult.reason;
  }
  if (movieResult.status === "rejected") {
    console.error("[searchMoviesAndTv] 映画検索に失敗しました(ドラマ側の結果のみ返却)", movieResult.reason);
  }
  if (tvResult.status === "rejected") {
    console.error("[searchMoviesAndTv] ドラマ検索に失敗しました(映画側の結果のみ返却)", tvResult.reason);
  }

  const movies = movieResult.status === "fulfilled" ? movieResult.value : [];
  const tv = tvResult.status === "fulfilled" ? tvResult.value : [];
  return [...movies, ...tv];
}

/**
 * クライアントが送ってきたtmdbId/mediaTypeを、TMDBへの再照会で検証する。
 * TMDBはID単体でのlookupをサポートするため、booksのverifyBookCandidateの
 * ようなtitle経由の間接照会は不要(直接ID lookupが正)。
 * 詳細取得のレスポンスにはruntime/episode_run_time等、検索結果には
 * 含まれない尺データが含まれる。
 */
export async function verifyMovieById(tmdbId: number, apiKey: string): Promise<TmdbCandidate | null> {
  const json = await tmdbFetch(`/movie/${tmdbId}`, {}, apiKey);
  if (json === null) return null;
  const parsed = MovieDetailSchema.safeParse(json);
  return parsed.success ? toMovieCandidate(parsed.data) : null;
}

export async function verifyTvById(tmdbId: number, apiKey: string): Promise<TmdbCandidate | null> {
  const json = await tmdbFetch(`/tv/${tmdbId}`, {}, apiKey);
  if (json === null) return null;
  const parsed = TvDetailSchema.safeParse(json);
  return parsed.success ? toTvCandidate(parsed.data) : null;
}

/**
 * サイズはgrid用途でw500を使う(book/musicのthumbnail/front-500と同じ運用)。
 * 変換は一切行わずソースAPIが提供するサイズをそのまま使う方針(spec 5参照)。
 */
export function buildImageUrl(posterPath: string): string {
  return `${TMDB_IMAGE_BASE}/w500${posterPath}`;
}
