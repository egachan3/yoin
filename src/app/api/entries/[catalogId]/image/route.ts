import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { isBlocked } from "@/db/blocks";

// 手動入力エントリのユーザーアップロード画像専用の配信ルート。
// R2画像プロキシ(/img/[workId]/[variant])は認証なしの全公開エンドポイントで、
// catalog_entities.owner_user_idが非nullの行を構造的に除外している
// (image-proxy.tsのresolveImageSource参照)。
//
// 【2026-08-19改訂】当初は「手動入力エントリは本人以外に表示されない」前提で
// 常に認証必須・本人確認必須だったが、公開棚(/@handle)の実装により
// この前提が崩れた(引き継ぎ.md タスク12の申し送り事項)。
// 表示可否はpublic-shelf.tsのresolvePublicShelfAccess()と同じ2軸
// (棚のis_public・ブロック関係)で判定する。本人アクセスは常に許可。
export async function GET(request: Request, context: { params: Promise<{ catalogId: string }> }) {
  const { catalogId } = await context.params;
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });

  const db = createDb(env.DB);
  const entity = await db
    .selectFrom("catalog_entities")
    .leftJoin("user", "user.id", "catalog_entities.owner_user_id")
    .select(["catalog_entities.owner_user_id as ownerId", "user.is_public as ownerIsPublic"])
    .where("catalog_entities.id", "=", catalogId)
    .executeTakeFirst();

  // 存在しないcatalogId・手動入力ではない(owner_user_idがnull)行はどちらも404
  if (!entity || !entity.ownerId) {
    return new Response(null, { status: 404 });
  }

  const isOwner = session?.user.id === entity.ownerId;
  if (!isOwner) {
    // 所有者不一致・非公開棚のどちらも404で返す(403にすると
    // 「存在はするが権限がない」ことをレスポンスコードで教えてしまうため)
    if (!entity.ownerIsPublic) {
      return new Response(null, { status: 404 });
    }
    if (session && (await isBlocked(db, session.user.id, entity.ownerId))) {
      return new Response(null, { status: 404 });
    }
  }

  const object = await env.IMAGE_CACHE.get(`manual/${catalogId}.jpg`);
  if (!object) {
    return new Response(null, { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      // 公開/非公開・ブロック関係はいつでも変わりうるため、共有(CDN)キャッシュ
      // は使わない(R2プロキシのbuildCacheControlのような長期publicキャッシュは
      // 不可。非公開に切り替えた直後も古いpublicキャッシュ経由で画像が漏れる)。
      // 本人閲覧は自分の端末内キャッシュなので長めに許容するが、閲覧者(本人以外)
      // への配信は非公開化・ブロックが即座に反映されるべきため短く抑える
      // (レビュー指摘: max-age=3600のままだと閲覧者のブラウザに最大1時間残る)
      "Cache-Control": isOwner ? "private, max-age=3600" : "private, max-age=60, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
