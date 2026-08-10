import { getCloudflareContext } from "@opennextjs/cloudflare";
import { toNextJsHandler } from "better-auth/next-js";
import { createAuth } from "@/lib/auth";

// D1バインディングはリクエストごとにしか取れないため、authインスタンスも
// リクエストごとに作る(src/lib/auth.tsのコメント参照)
async function handler(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);
  return auth.handler(request);
}

export const { GET, POST } = toNextJsHandler(handler);
