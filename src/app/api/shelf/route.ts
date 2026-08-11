import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";

export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createDb(env.DB);

  // ジャンルを問わず本人の棚エントリを一覧取得する(グリッド表示用)。
  // ジャンルが増えても(音楽・映画等)このエンドポイントとJOIN構造は
  // 変更不要で、追加が必要なのはsource側の検索/追加APIのみになる想定
  const entries = await db
    .selectFrom("shelf_entries")
    .innerJoin("catalog_entities", "catalog_entities.id", "shelf_entries.catalog_id")
    .select([
      "shelf_entries.id",
      "shelf_entries.status",
      "shelf_entries.comment",
      "shelf_entries.rating",
      "shelf_entries.added_at",
      "catalog_entities.genre",
      "catalog_entities.title",
      "catalog_entities.primary_image_ref",
    ])
    .where("shelf_entries.user_id", "=", session.user.id)
    .orderBy("shelf_entries.added_at", "desc")
    .limit(100)
    .execute();

  return Response.json({ entries });
}
