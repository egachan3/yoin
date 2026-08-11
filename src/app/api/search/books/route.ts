import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { searchBooks, type SearchField } from "@/lib/sources/ndl";

function parseField(value: string | null): SearchField | undefined {
  return value === "title" || value === "creator" ? value : undefined;
}

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
  // 「もっと探す」で継続する場合、前回のレスポンスが返したfieldをそのまま
  // 渡してもらう(渡されなければ初回検索として扱い、title→creatorの
  // フォールバック判定が働く)
  const field = parseField(searchParams.get("field"));

  try {
    const result = await searchBooks(query, 10, Number.isFinite(startRecord) ? startRecord : 1, field);
    return Response.json(result);
  } catch {
    return Response.json(
      { error: "search_failed", message: "検索に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }
}
