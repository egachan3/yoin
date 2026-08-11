import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { searchBooks } from "@/lib/sources/ndl";

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
  const startRecordParam = searchParams.get("startRecord");
  const startRecord = startRecordParam ? Number(startRecordParam) : 1;

  try {
    const result = await searchBooks(query, 10, Number.isFinite(startRecord) ? startRecord : 1);
    return Response.json(result);
  } catch {
    return Response.json(
      { error: "search_failed", message: "検索に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }
}
