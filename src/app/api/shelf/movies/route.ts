import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { findOrCreateMovieCatalogEntity } from "@/db/catalog";
import { verifyMovieById, verifyTvById, type TmdbCandidate } from "@/lib/sources/tmdb";
import { ReviewFieldsSchema, normalizeReviewFields } from "@/lib/review";

// tmdbId/mediaTypeのみを「再照会のヒント」として受け取る。title等はクライアントから
// 受け取らない(book/musicと同じく再照会結果のみを信頼する)
const AddMovieSchema = z
  .object({
    mediaType: z.enum(["movie", "tv"]),
    tmdbId: z.number().int().positive(),
  })
  .extend(ReviewFieldsSchema.shape);

async function verifyMovieCandidate(mediaType: "movie" | "tv", tmdbId: number, apiKey: string): Promise<TmdbCandidate | null> {
  return mediaType === "movie" ? verifyMovieById(tmdbId, apiKey) : verifyTvById(tmdbId, apiKey);
}

// 映画: runtimeMinutes(分)をそのまま使う。ドラマ: episodeRuntimeMinutes×numberOfEpisodes。
// どちらも値が0または欠落ならduration_pending=1(将来埋まり得る区分。book/musicと同じ考え方)
function computeDuration(candidate: TmdbCandidate): {
  estimatedSeconds: number | null;
  pending: 0 | 1;
  rawValue: string | null;
  rawUnit: string | null;
} {
  if (candidate.mediaType === "movie") {
    const runtime = candidate.runtimeMinutes;
    if (!runtime || runtime <= 0) {
      return { estimatedSeconds: null, pending: 1, rawValue: null, rawUnit: null };
    }
    return { estimatedSeconds: runtime * 60, pending: 0, rawValue: String(runtime), rawUnit: "minute" };
  }

  const episodeRuntime = candidate.episodeRuntimeMinutes;
  const numberOfEpisodes = candidate.numberOfEpisodes;
  if (!episodeRuntime || episodeRuntime <= 0 || !numberOfEpisodes || numberOfEpisodes <= 0) {
    return { estimatedSeconds: null, pending: 1, rawValue: null, rawUnit: null };
  }
  return {
    estimatedSeconds: episodeRuntime * numberOfEpisodes * 60,
    pending: 0,
    rawValue: JSON.stringify({ episodeRuntimeMinutes: episodeRuntime, numberOfEpisodes }),
    rawUnit: "minute_per_episode",
  };
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // 設定不足(APIキー未設定)は入力不備より先に検知する(search/movies/route.tsと
  // 同じ理由。レビュー指摘)
  if (!env.TMDB_API_KEY) {
    return Response.json(
      { error: "not_configured", message: "TMDB APIキーが設定されていません。" },
      { status: 502 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = AddMovieSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", message: "入力内容が不正です。" }, { status: 422 });
  }

  let candidate: TmdbCandidate | null;
  try {
    candidate = await verifyMovieCandidate(parsed.data.mediaType, parsed.data.tmdbId, env.TMDB_API_KEY);
  } catch {
    return Response.json(
      { error: "verify_failed", message: "確認に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }
  if (!candidate) {
    return Response.json(
      { error: "not_found", message: "指定された作品が見つかりませんでした。検索からやり直してください。" },
      { status: 422 },
    );
  }

  const db = createDb(env.DB);

  const duration = computeDuration(candidate);
  const review = normalizeReviewFields(parsed.data);
  const now = Math.floor(Date.now() / 1000);
  const entryId = uuidv7();

  let catalogId: string;
  try {
    catalogId = await findOrCreateMovieCatalogEntity(db, env.DB, candidate, {
      id: entryId,
      user_id: session.user.id,
      source_type: "manual_search",
      // 映画・ドラマの追加時デフォルト状態はcompleted(spec決定: 「観た後に記録」が
      // 主要動線のため。書籍・ゲームのplannedとは異なる)
      status: "completed",
      is_revisiting: 0,
      revisit_count: 0,
      comment: review.comment,
      rating: review.rating,
      estimated_duration_seconds: duration.estimatedSeconds,
      duration_pending: duration.pending,
      raw_duration_value: duration.rawValue,
      raw_duration_unit: duration.rawUnit,
      added_at: now,
      completed_at: now,
      created_at: now,
      updated_at: now,
    });
  } catch {
    return Response.json(
      { error: "add_failed", message: "追加に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }

  return Response.json({ id: entryId, catalogId }, { status: 201 });
}
