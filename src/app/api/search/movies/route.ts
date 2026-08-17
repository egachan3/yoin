import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { searchMovies, searchTv } from "@/lib/sources/tmdb";

export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // 設定不足(APIキー未設定)は入力不備より先に検知する。開発時に空クエリで
  // 気づかず「検索語を入力してください」だけが表示され、根本原因(設定不足)に
  // 気づきにくくなるのを避けるため(レビュー指摘)
  if (!env.TMDB_API_KEY) {
    return Response.json(
      { error: "not_configured", message: "TMDB APIキーが設定されていません。" },
      { status: 502 },
    );
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  if (!query) {
    return Response.json({ error: "invalid_query", message: "検索語を入力してください。" }, { status: 422 });
  }
  const pageParam = searchParams.get("page");
  const page = pageParam ? Number(pageParam) : 1;
  const safePage = Number.isFinite(page) && page >= 1 ? page : 1;

  // 棚のカテゴリが映画とドラマに分かれたのに伴い、検索も片方ずつに分けた
  // (引き継ぎ.md 3.5節)。以前は/search/movieと/search/tvを同時に叩いて
  // 結果を統合していたが、その分TMDBへのリクエストが倍かかっていた
  const mediaType = searchParams.get("mediaType");
  if (mediaType !== "movie" && mediaType !== "tv") {
    return Response.json({ error: "invalid_query", message: "種別が不正です。" }, { status: 422 });
  }

  try {
    const candidates =
      mediaType === "movie"
        ? await searchMovies(query, env.TMDB_API_KEY, safePage)
        : await searchTv(query, env.TMDB_API_KEY, safePage);
    return Response.json({ candidates });
  } catch {
    return Response.json(
      { error: "search_failed", message: "検索に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }
}
