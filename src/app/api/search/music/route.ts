import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import {
  searchRecordings,
  searchReleaseGroups,
  fetchCoverArtByRelease,
  fetchCoverArtByReleaseGroup,
  type MusicCandidate,
} from "@/lib/sources/musicbrainz";
import { searchItunes, type ItunesCandidate } from "@/lib/sources/itunes";

type Entity = "song" | "album";

function parseEntity(value: string | null): Entity {
  return value === "album" ? "album" : "song";
}

// CAAはMusicBrainz本体と異なりレート制限がない(spec 3.2参照)が、最大10件を
// 無条件で並列問い合わせると最遅の1件を待つ形で検索結果表示全体が遅延しうる
// (PR #16最終レビュー指摘)。上位のみに絞って遅延を抑える。
// 【重要】Apple Music APIへ切り替える際(引き継ぎ.md タスク13)、ジャケット取得
// ロジックごと置き換わるため、この制限は解除してよい
const COVER_ART_LOOKUP_LIMIT = 5;

/**
 * 検索結果一覧に小さいジャケット画像を出すため、MusicBrainz由来の候補のうち
 * 上位COVER_ART_LOOKUP_LIMIT件にのみCover Art Archiveのジャケットを並列で
 * 問い合わせる。1件でも取得失敗した場合はその候補だけimageUrl: nullにし、
 * 検索結果全体は失敗させない。
 *
 * iTunes由来の候補には画像を一切付けない(Promo Content規約上アートワーク不使用の
 * 決定に従う。ItunesCandidateの型自体がアートワークを持てない設計と対になる)。
 */
export async function attachCoverArt(candidates: MusicCandidate[]): Promise<(MusicCandidate & { imageUrl: string | null })[]> {
  const targets = candidates.slice(0, COVER_ART_LOOKUP_LIMIT);
  const rest = candidates.slice(COVER_ART_LOOKUP_LIMIT);

  const withImages = await Promise.all(
    targets.map(async (c) => {
      try {
        const imageUrl =
          c.entityType === "release-group"
            ? await fetchCoverArtByReleaseGroup(c.sourceId)
            : c.releaseIdForCoverArt
              ? await fetchCoverArtByRelease(c.releaseIdForCoverArt)
              : null;
        return { ...c, imageUrl };
      } catch {
        return { ...c, imageUrl: null };
      }
    }),
  );

  return [...withImages, ...rest.map((c) => ({ ...c, imageUrl: null }))];
}

function attachNullImage(candidates: ItunesCandidate[]): (ItunesCandidate & { imageUrl: null })[] {
  return candidates.map((c) => ({ ...c, imageUrl: null }));
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
        return Response.json({ candidates: attachNullImage(itunesCandidates), nextOffset: null, source: "itunes" });
      }
    }

    const candidatesWithImage = await attachCoverArt(primary.candidates);
    return Response.json({ candidates: candidatesWithImage, nextOffset: primary.nextOffset, source: "musicbrainz" });
  } catch {
    return Response.json(
      { error: "search_failed", message: "検索に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }
}
