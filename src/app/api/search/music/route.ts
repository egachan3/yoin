import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { searchRecordings, searchReleaseGroups } from "@/lib/sources/musicbrainz";
import { searchItunes } from "@/lib/sources/itunes";

type Entity = "song" | "album";

function parseEntity(value: string | null): Entity {
  return value === "album" ? "album" : "song";
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
  const entity = parseEntity(searchParams.get("entityType"));
  const offsetParam = searchParams.get("offset");
  const offset = offsetParam ? Number(offsetParam) : 0;
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;

  try {
    const primary =
      entity === "song"
        ? await searchRecordings(query, 10, safeOffset)
        : await searchReleaseGroups(query, 10, safeOffset);

    // MusicBrainzが0件のときのみiTunesへフォールバックする(NDLのtitle→creator
    // フォールバックと同じ考え方)。「もっと探す」(offset>0)では継続ページの
    // 一貫性を保つためフォールバックしない
    if (primary.candidates.length === 0 && safeOffset === 0) {
      const itunesCandidates = await searchItunes(query, entity, 10);
      if (itunesCandidates.length > 0) {
        // iTunesは公式にoffsetページングをサポートしないため「もっと探す」は出さない
        return Response.json({ candidates: itunesCandidates, nextOffset: null, source: "itunes" });
      }
    }

    return Response.json({ candidates: primary.candidates, nextOffset: primary.nextOffset, source: "musicbrainz" });
  } catch {
    return Response.json(
      { error: "search_failed", message: "検索に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }
}
