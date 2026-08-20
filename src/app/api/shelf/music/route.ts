import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { findOrCreateMusicCatalogEntity, type MusicSourceCandidate } from "@/db/catalog";
import { verifyRecordingById, verifyReleaseGroupById, fetchReleaseGroupDurationMs } from "@/lib/sources/musicbrainz";
import { verifyById as verifyItunesById, fetchAlbumDurationMs } from "@/lib/sources/itunes";
import { ReviewFieldsSchema, normalizeReviewFields } from "@/lib/review";

// sourceId/entityTypeのみを「再照会のヒント」として受け取る。title/artist等は
// クライアントから受け取らない(booksのverifyBookCandidateと同じ考え方: 再照会
// 結果のみを信頼する)
const AddMusicSchema = z
  .object({
    source: z.enum(["musicbrainz", "itunes"]),
    sourceId: z.string().min(1).max(100),
    entityType: z.enum(["song", "album"]),
  })
  .extend(ReviewFieldsSchema.shape);

/**
 * クライアントが送ってきたID(MBIDまたはiTunes numeric id)を、各ソースへの
 * 再照会で検証する。MusicBrainz/iTunesはどちらもID直接lookupをサポートするため、
 * NDLのようなtitle経由の間接照会は不要(ID自体が正であることの確認で足りる)。
 */
async function verifyMusicCandidate(
  source: "musicbrainz" | "itunes",
  sourceId: string,
  entityType: "song" | "album",
): Promise<MusicSourceCandidate | null> {
  if (source === "musicbrainz") {
    return entityType === "song" ? verifyRecordingById(sourceId) : verifyReleaseGroupById(sourceId);
  }
  return verifyItunesById(sourceId, entityType);
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = AddMusicSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", message: "入力内容が不正です。" }, { status: 422 });
  }

  let candidate: MusicSourceCandidate | null;
  try {
    candidate = await verifyMusicCandidate(parsed.data.source, parsed.data.sourceId, parsed.data.entityType);
  } catch {
    return Response.json(
      { error: "verify_failed", message: "確認に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }
  if (!candidate) {
    return Response.json(
      { error: "not_found", message: "指定された曲・アルバムが見つかりませんでした。検索からやり直してください。" },
      { status: 422 },
    );
  }

  const db = createDb(env.DB);

  // 曲(recording/song)は検索結果のlengthMsをそのまま使う。アルバム(release-group/album)は
  // 検索結果に合計時間を持たないため、収録曲ごとの長さを追加ルックアップして合計する
  // (音楽PR #3では意図的にスコープ外にした部分。1曲でも長さが取れなければ合計を出さず
  // nullのまま扱う。過小な合計値を確定した推定消費時間として提示しないため)
  let lengthMs = candidate.lengthMs;
  if (lengthMs === null && parsed.data.entityType === "album") {
    lengthMs =
      candidate.source === "musicbrainz"
        ? await fetchReleaseGroupDurationMs(candidate.sourceId)
        : await fetchAlbumDurationMs(candidate.sourceId);
  }
  const estimatedSeconds = lengthMs !== null ? Math.round(lengthMs / 1000) : null;
  const review = normalizeReviewFields(parsed.data);

  const now = Math.floor(Date.now() / 1000);
  const entryId = uuidv7();

  let catalogId: string;
  try {
    catalogId = await findOrCreateMusicCatalogEntity(db, env.DB, candidate, {
      id: entryId,
      user_id: session.user.id,
      source_type: "manual_search",
      // 音楽の追加時デフォルト状態はcompleted(spec決定: セクション5「追加時の
      // デフォルト状態」。MVPのUIはplanned/completedの2択のみ露出する方針だが、
      // 音楽は「聴いた後に記録」が主要動線のためcompleted一択で登録する)
      status: "completed",
      is_revisiting: 0,
      revisit_count: 0,
      comment: review.comment,
      rating: review.rating,
      estimated_duration_seconds: estimatedSeconds,
      duration_pending: lengthMs === null ? 1 : 0,
      raw_duration_value: lengthMs !== null ? String(lengthMs) : null,
      raw_duration_unit: lengthMs !== null ? "millisecond" : null,
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
