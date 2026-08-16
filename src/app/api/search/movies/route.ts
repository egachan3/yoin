import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { searchMoviesAndTv } from "@/lib/sources/tmdb";

export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  if (!query) {
    return Response.json({ error: "invalid_query", message: "検索語を入力してください。" }, { status: 422 });
  }
  const pageParam = searchParams.get("page");
  const page = pageParam ? Number(pageParam) : 1;
  const safePage = Number.isFinite(page) && page >= 1 ? page : 1;

  if (!env.TMDB_API_KEY) {
    return Response.json(
      { error: "not_configured", message: "TMDB APIキーが設定されていません。" },
      { status: 502 },
    );
  }

  try {
    const candidates = await searchMoviesAndTv(query, env.TMDB_API_KEY, safePage);
    return Response.json({ candidates });
  } catch {
    return Response.json(
      { error: "search_failed", message: "検索に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }
}
