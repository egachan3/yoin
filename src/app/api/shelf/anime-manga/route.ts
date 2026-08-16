import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { findOrCreateAnimeMangaCatalogEntity } from "@/db/catalog";
import { verifyMalCandidate, computeDuration, MalRateLimitError, type MalCandidate } from "@/lib/sources/mal";

// malId/mediaTypeのみを「再照会のヒント」として受け取る。title等はクライアントから
// 受け取らない(book/music/movieと同じく再照会結果のみを信頼する)
const AddAnimeMangaSchema = z.object({
  mediaType: z.enum(["anime", "manga"]),
  malId: z.number().int().positive(),
});

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!env.MAL_CLIENT_ID) {
    return Response.json(
      { error: "not_configured", message: "MyAnimeListのClient IDが設定されていません。" },
      { status: 502 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = AddAnimeMangaSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", message: "入力内容が不正です。" }, { status: 422 });
  }

  let candidate: MalCandidate | null;
  try {
    candidate = await verifyMalCandidate(parsed.data.mediaType, parsed.data.malId, env.MAL_CLIENT_ID);
  } catch (err) {
    if (err instanceof MalRateLimitError) {
      return Response.json(
        { error: "rate_limited", message: "混み合っています。少し時間をおいてお試しください。" },
        { status: 429 },
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

  let catalogId: string;
  try {
    catalogId = await findOrCreateAnimeMangaCatalogEntity(db, env.DB, candidate);
  } catch {
    return Response.json(
      { error: "add_failed", message: "追加に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }

  const duration = computeDuration(candidate);
  const now = Math.floor(Date.now() / 1000);
  const entryId = uuidv7();

  try {
    await db
      .insertInto("shelf_entries")
      .values({
        id: entryId,
        user_id: session.user.id,
        catalog_id: catalogId,
        source_type: "manual_search",
        // アニメ・マンガのデフォルト状態はcompleted(spec セクション5の初期値テーブル。
        // 「映画・ドラマ・アニメ・マンガ = completed」とマンガも含めて決定済み)。
        // planned に倒すとcompleted_atがNULLになり、リキャップの推定消費時間
        // (completed_at基準で期間を絞る)から永久に除外される
        status: "completed",
        is_revisiting: 0,
        revisit_count: 0,
        comment: null,
        rating: null,
        estimated_duration_seconds: duration.estimatedSeconds,
        duration_pending: duration.pending,
        raw_duration_value: duration.rawValue,
        raw_duration_unit: duration.rawUnit,
        added_at: now,
        completed_at: now,
        created_at: now,
        updated_at: now,
      })
      .execute();
  } catch {
    return Response.json(
      { error: "add_failed", message: "追加に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }

  return Response.json({ id: entryId, catalogId }, { status: 201 });
}
