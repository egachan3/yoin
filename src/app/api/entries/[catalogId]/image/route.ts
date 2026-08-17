import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";

// 手動入力エントリのユーザーアップロード画像専用の配信ルート。
// R2画像プロキシ(/img/[workId]/[variant])は認証なしの全公開エンドポイントで、
// catalog_entities.owner_user_idが非nullの行を構造的に除外している
// (image-proxy.tsのresolveImageSource参照)。手動入力エントリは本人以外に
// 表示されない設計のため、こちらは逆に認証必須にし、リクエスト元が
// owner_user_id本人であることを確認してからのみR2オブジェクトを返す。
export async function GET(request: Request, context: { params: Promise<{ catalogId: string }> }) {
  const { catalogId } = await context.params;
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response(null, { status: 401 });
  }

  const db = createDb(env.DB);
  const entity = await db
    .selectFrom("catalog_entities")
    .select("owner_user_id")
    .where("id", "=", catalogId)
    .executeTakeFirst();

  // 所有者不一致・存在しないcatalogIdのどちらも404で返す(403にすると
  // 「存在はするが権限がない」ことをレスポンスコードで教えてしまうため)
  if (!entity || entity.owner_user_id !== session.user.id) {
    return new Response(null, { status: 404 });
  }

  const object = await env.IMAGE_CACHE.get(`manual/${catalogId}.jpg`);
  if (!object) {
    return new Response(null, { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      // 本人以外に配信されない前提の私的な画像のため、共有キャッシュを想定した
      // 長期キャッシュ(R2プロキシのbuildCacheControlのような設計)は使わない
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
