import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { findOrCreateGameCatalogEntity } from "@/db/catalog";
import {
  verifyGameById,
  computeDuration,
  IgdbUnauthorizedError,
  IgdbRateLimitError,
  IGDB_RATE_LIMIT,
  IGDB_RATE_LIMIT_KEY,
  type IgdbCandidate,
} from "@/lib/sources/igdb";
import { checkRateLimit } from "@/lib/rate-limit";
import { ReviewFieldsSchema, normalizeReviewFields } from "@/lib/review";

// igdbIdのみを「再照会のヒント」として受け取る。title等はクライアントから
// 受け取らない(他ジャンルと同じく再照会結果のみを信頼する)
const AddGameSchema = z
  .object({
    igdbId: z.number().int().positive(),
  })
  .extend(ReviewFieldsSchema.shape)
  .extend({ isPublic: z.boolean().optional() });

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) {
    return Response.json(
      { error: "not_configured", message: "IGDBのClient ID/Secretが設定されていません。" },
      { status: 502 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = AddGameSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", message: "入力内容が不正です。" }, { status: 422 });
  }

  // 追加もIGDBへの実リクエスト(verifyGameById)を発生させるため、検索と枠を
  // 共有してレート制限をかける(MALと同じ考え方。片方だけ塞ぐと迂回路が残る)
  if (!(await checkRateLimit(env.RATE_LIMIT, IGDB_RATE_LIMIT_KEY, session.user.id, IGDB_RATE_LIMIT))) {
    return Response.json(
      { error: "rate_limited", message: "操作の回数が多すぎます。少し時間をおいてお試しください。" },
      { status: 429 },
    );
  }

  let candidate: IgdbCandidate | null;
  try {
    candidate = await verifyGameById(parsed.data.igdbId, env.RATE_LIMIT, env.IGDB_CLIENT_ID, env.IGDB_CLIENT_SECRET);
  } catch (err) {
    if (err instanceof IgdbRateLimitError) {
      return Response.json(
        { error: "rate_limited", message: "混み合っています。少し時間をおいてお試しください。" },
        { status: 429 },
      );
    }
    if (err instanceof IgdbUnauthorizedError) {
      return Response.json(
        { error: "not_configured", message: "IGDBとの認証に失敗しました。しばらくしてから再度お試しください。" },
        { status: 502 },
      );
    }
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
    catalogId = await findOrCreateGameCatalogEntity(db, env.DB, candidate, {
      id: entryId,
      user_id: session.user.id,
      source_type: "manual_search",
      // 従来はゲームもplanned(spec セクション5の初期値テーブル)だったが、
      // ステータスをUIから廃止したのに伴い全ジャンルcompleted固定に統一した
      // (引き継ぎ.md 3.5節)。DBの列自体は将来の復活に備えて残している
      status: "completed",
      is_revisiting: 0,
      revisit_count: 0,
      comment: review.comment,
      rating: review.rating,
      is_public: parsed.data.isPublic === false ? 0 : 1,
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
