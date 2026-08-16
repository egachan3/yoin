import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb } from "@/db/client";
import { isValidVariant, resolveImageSource, serveWorkImage } from "@/lib/image-proxy";

// 【重要】このルートは認証を要求しない。catalog_entitiesはユーザー個別の
// データではなく正規化された共有カタログであり、公開棚(非ログインの
// 匿名訪問者にも見られる前提。spec セクション7・11)からも画像を表示する
// 必要があるため。
export async function GET(request: Request, context: { params: Promise<{ workId: string; variant: string }> }) {
  const { workId, variant } = await context.params;

  if (!isValidVariant(variant)) {
    return new Response(null, { status: 404 });
  }

  const { env, ctx } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);

  const source = await resolveImageSource(db, workId);
  return serveWorkImage(
    { r2: env.IMAGE_CACHE, kv: env.RATE_LIMIT, waitUntil: (p) => ctx.waitUntil(p) },
    workId,
    variant,
    source,
  );
}
