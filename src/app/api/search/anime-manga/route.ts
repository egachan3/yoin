import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import {
  searchMal,
  MalRateLimitError,
  MalBadRequestError,
  MAL_MIN_QUERY_LENGTH,
  MAL_SEARCH_LIMIT,
  type MalMediaType,
} from "@/lib/sources/mal";

function parseMediaType(value: string | null): MalMediaType | null {
  return value === "anime" || value === "manga" ? value : null;
}

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 30;

/**
 * ユーザーごとの検索回数を制限する。
 *
 * MALのClient IDは全ユーザーで共有される単一のグローバル資源で、しかも
 * レート制限が約1req/秒と厳しい(spec 3.4)。1人が連打すると**全ユーザーの**
 * アニメ・マンガ検索が403で止まるため、その経路だけは塞いでおく。
 * KVには原子的なインクリメントがないため厳密な上限保証ではないが、
 * 暴走の抑止という目的には十分(onboarding/handleと同じ考え方)。
 *
 * 厳密な1req/秒のグローバル直列化はDurable Objectsなしには作れないため、
 * MVPではper-userの上限に留める。
 */
async function checkSearchRateLimit(kv: KVNamespace, userId: string): Promise<boolean> {
  const key = `mal-search:${userId}`;
  const current = await kv.get(key);
  const count = current ? Number(current) : 0;
  if (count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return true;
}

export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // 設定不足(Client ID未設定)は入力不備より先に検知する(search/movies/route.tsと同じ理由)
  if (!env.MAL_CLIENT_ID) {
    return Response.json(
      { error: "not_configured", message: "MyAnimeListのClient IDが設定されていません。" },
      { status: 502 },
    );
  }

  const { searchParams } = new URL(request.url);

  // アニメ/マンガは同時に検索しない(spec 5.4)。MALのレート制限が約1req/秒のため、
  // 並列2本は即座に制限超過になる。どちらを検索するかは必須パラメータとして受け取る
  const mediaType = parseMediaType(searchParams.get("type"));
  if (!mediaType) {
    return Response.json(
      { error: "invalid_type", message: "種別(anime/manga)を指定してください。" },
      { status: 422 },
    );
  }

  const query = searchParams.get("q")?.trim();
  if (!query) {
    return Response.json({ error: "invalid_query", message: "検索語を入力してください。" }, { status: 422 });
  }
  // MALは1文字クエリだと400を返す。APIに投げる前に弾いてレート消費を避ける
  if (query.length < MAL_MIN_QUERY_LENGTH) {
    return Response.json(
      { error: "query_too_short", message: `検索語は${MAL_MIN_QUERY_LENGTH}文字以上で入力してください。` },
      { status: 422 },
    );
  }

  // TMDBのpageと違いMALはoffsetベースのページング。「もっと探す」用に受け取る
  const offsetParam = searchParams.get("offset");
  const offset = offsetParam ? Number(offsetParam) : 0;
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;

  // 入力の妥当性を確認した後にレート制限を消費する(不正な入力で枠を減らさない)
  if (!(await checkSearchRateLimit(env.RATE_LIMIT, session.user.id))) {
    return Response.json(
      { error: "rate_limited", message: "検索の回数が多すぎます。少し時間をおいてお試しください。" },
      { status: 429 },
    );
  }

  try {
    const candidates = await searchMal(mediaType, query, env.MAL_CLIENT_ID, safeOffset);
    // MALのレスポンスにもpaging.nextはあるが、URLをそのまま返すとClient IDを含む
    // 内部URLの扱いが煩雑になるため、件数から次オフセットを組み立てる(musicと同じ方式)。
    // limitちょうど返ってきた場合のみ次ページがあり得ると見なす
    const nextOffset = candidates.length === MAL_SEARCH_LIMIT ? safeOffset + MAL_SEARCH_LIMIT : null;
    return Response.json({ candidates, nextOffset, mediaType });
  } catch (err) {
    // MALはレート制限を403で返す(429ではない)。ユーザーに「時間をおいて再試行」と
    // 案内できるよう、汎用の検索失敗と区別して429で返す(spec 3.4)
    if (err instanceof MalRateLimitError) {
      return Response.json(
        { error: "rate_limited", message: "混み合っています。少し時間をおいてお試しください。" },
        { status: 429 },
      );
    }
    // MAL側が入力を受け付けなかった場合。MAL_MIN_QUERY_LENGTHの推定が
    // 実際の閾値と違っていてもここで拾えるため、ユーザーがリトライを
    // 繰り返して詰むことがない
    if (err instanceof MalBadRequestError) {
      return Response.json(
        { error: "invalid_query", message: "検索できませんでした。検索語を長くするか、別の語でお試しください。" },
        { status: 422 },
      );
    }
    return Response.json(
      { error: "search_failed", message: "検索に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }
}
