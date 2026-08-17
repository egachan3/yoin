import { getCloudflareContext } from "@opennextjs/cloudflare";
import { toNextJsHandler } from "better-auth/next-js";
import { createAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

// better-authの組み込みレート制限(デフォルト有効)は、上限判定に使うカウンタを
// メモリ内(Map)に保持する実装のため、リクエストごとにアイソレートが使い捨てられる
// Cloudflare Workers環境では確実に共有されず実質機能しない。マジックリンク送信は
// 未認証で誰でも叩けるうえ、悪用されるとResendの送信数課金・spam報告に直結するため、
// MAL/IGDB検索と同じKVベースの自前レート制限(src/lib/rate-limit.ts)を明示的にかける。
//
// IPと送信先メールアドレスの両方で制限する: IP制限だけだと同一IPからの連打は防げるが
// 複数IPを使い分けて特定のメールアドレスを狙い撃ちする攻撃は防げない。逆にメール制限
// だけだと、メールアドレスをランダムに変えながら大量送信するbotを防げない
const MAGIC_LINK_IP_RATE_LIMIT = { windowSeconds: 60, maxRequests: 5 };
const MAGIC_LINK_EMAIL_RATE_LIMIT = { windowSeconds: 300, maxRequests: 3 };

// パス判定は完全一致にする(レビュー指摘)。endsWith等の緩い一致だと、
// better-auth側のルーティングが将来的に末尾スラッシュ等を正規化するようになった場合に
// レート制限だけをすり抜けられる経路が生まれうる。現状は末尾スラッシュ付きだと
// better-auth側が404を返す(正規化しない)ことを実機確認済みだが、ホワイトリスト的な
// 厳密一致にしておく方が安全
function isMagicLinkSignInRequest(request: Request): boolean {
  return request.method === "POST" && new URL(request.url).pathname === "/api/auth/sign-in/magic-link";
}

// D1バインディングはリクエストごとにしか取れないため、authインスタンスも
// リクエストごとに作る(src/lib/auth.tsのコメント参照)
async function handler(request: Request) {
  const { env } = await getCloudflareContext({ async: true });

  if (isMagicLinkSignInRequest(request)) {
    // cf-connecting-ipはCloudflareが常に付与する実クライアントIP。
    // 取得できない場合(理論上は起きない)は空文字扱いで制限をかけずに通す
    const ip = request.headers.get("cf-connecting-ip") ?? "";
    if (ip && !(await checkRateLimit(env.RATE_LIMIT, "magic-link-ip", ip, MAGIC_LINK_IP_RATE_LIMIT))) {
      return Response.json({ error: "rate_limited", message: "送信回数が多すぎます。少し時間をおいてお試しください。" }, { status: 429 });
    }

    // ボディを読むとストリームが消費され後段のauth.handler()に渡せなくなるため、
    // clone()した側だけを読む(元のrequestは未読のまま渡す)
    const body = (await request
      .clone()
      .json()
      .catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
    if (email && !(await checkRateLimit(env.RATE_LIMIT, "magic-link-email", email, MAGIC_LINK_EMAIL_RATE_LIMIT))) {
      return Response.json({ error: "rate_limited", message: "送信回数が多すぎます。少し時間をおいてお試しください。" }, { status: 429 });
    }
  }

  const auth = createAuth(env);
  return auth.handler(request);
}

export const { GET, POST } = toNextJsHandler(handler);
