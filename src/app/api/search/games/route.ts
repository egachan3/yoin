import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import {
  searchGames,
  IgdbUnauthorizedError,
  IgdbRateLimitError,
  IGDB_RATE_LIMIT,
  IGDB_RATE_LIMIT_KEY,
} from "@/lib/sources/igdb";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // 設定不足(Client ID/Secret未設定)は入力不備より先に検知する(他ジャンルと同じ理由)
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) {
    return Response.json(
      { error: "not_configured", message: "IGDBのClient ID/Secretが設定されていません。" },
      { status: 502 },
    );
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  if (!query) {
    return Response.json({ error: "invalid_query", message: "検索語を入力してください。" }, { status: 422 });
  }

  // IGDB(4req/秒)もMALと同じく全ユーザー共有のClient-ID資源のため、
  // 1人の過剰利用が全員に波及する経路を塞ぐ(検索・追加で枠を共有)
  if (!(await checkRateLimit(env.RATE_LIMIT, IGDB_RATE_LIMIT_KEY, session.user.id, IGDB_RATE_LIMIT))) {
    return Response.json(
      { error: "rate_limited", message: "検索の回数が多すぎます。少し時間をおいてお試しください。" },
      { status: 429 },
    );
  }

  try {
    const candidates = await searchGames(query, env.RATE_LIMIT, env.IGDB_CLIENT_ID, env.IGDB_CLIENT_SECRET);
    return Response.json({ candidates });
  } catch (err) {
    if (err instanceof IgdbRateLimitError) {
      return Response.json(
        { error: "rate_limited", message: "混み合っています。少し時間をおいてお試しください。" },
        { status: 429 },
      );
    }
    if (err instanceof IgdbUnauthorizedError) {
      // トークン再発行を1回試みても401が続いた = Client ID/Secretの設定不備、
      // またはIGDB側の障害。ユーザーには設定不足と同じ扱いで案内する
      return Response.json(
        { error: "not_configured", message: "IGDBとの認証に失敗しました。しばらくしてから再度お試しください。" },
        { status: 502 },
      );
    }
    return Response.json(
      { error: "search_failed", message: "検索に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }
}
