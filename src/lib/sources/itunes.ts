// iTunes Search APIクライアント。MusicBrainzが日本語楽曲で薄い結果しか返さない場合の
// フォールバック専用。テキストメタデータのみを扱い、アートワークは一切使わない。
// 参照: shelf-type-app-spec.md セクション3.2「フォールバック: iTunes Search API」
//       (アルバムアート・プレビュー音源はPromo Content規約上使用しないと決定済み)

import { z } from "zod";

const ITUNES_SEARCH_BASE = "https://itunes.apple.com/search";
const ITUNES_LOOKUP_BASE = "https://itunes.apple.com/lookup";

// artworkUrl*系フィールドは意図的にスキーマへ含めない。パース結果の型自体が
// アートワークURLを持てない構造にすることで、誤って使ってしまうことを防ぐ
// (google-books.tsのimageLinks限定パターンの逆: こちらは特定フィールドを
// 除外する形での型レベル強制)
const TrackSchema = z.object({
  wrapperType: z.enum(["track", "collection"]),
  trackId: z.number().optional(),
  trackName: z.string().optional(),
  trackTimeMillis: z.number().optional(),
  collectionId: z.number().optional(),
  collectionName: z.string().optional(),
  artistName: z.string().optional(),
});

const SearchResponseSchema = z.object({
  resultCount: z.number(),
  results: z.array(TrackSchema),
});

export type ItunesEntityType = "song" | "album";

export interface ItunesCandidate {
  source: "itunes";
  entityType: ItunesEntityType;
  sourceId: string;
  title: string;
  artist: string | null;
  /** 曲のみ。アルバム(collection)はiTunes検索結果に合計時間を持たない */
  lengthMs: number | null;
}

function toCandidate(track: z.infer<typeof TrackSchema>, entityType: ItunesEntityType): ItunesCandidate | null {
  if (entityType === "song") {
    // wrapperTypeが"track"であることも確認する。trackオブジェクトは自身が属する
    // アルバムのcollectionId/collectionNameも同時に含むため、この確認がないと
    // 「trackIdをentityType: album扱いでlookupする」というクライアントの不正な
    // 組み合わせでも、trackオブジェクトのcollection*フィールドがそのまま
    // アルバム候補として通ってしまう(verifyByIdでのなりすまし経路になる)
    if (track.wrapperType !== "track" || track.trackId === undefined || !track.trackName) return null;
    return {
      source: "itunes",
      entityType: "song",
      sourceId: String(track.trackId),
      title: track.trackName,
      artist: track.artistName ?? null,
      lengthMs: track.trackTimeMillis ?? null,
    };
  }
  if (track.wrapperType !== "collection" || track.collectionId === undefined || !track.collectionName) return null;
  return {
    source: "itunes",
    entityType: "album",
    sourceId: String(track.collectionId),
    title: track.collectionName,
    artist: track.artistName ?? null,
    lengthMs: null,
  };
}

async function itunesFetch(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(6000) });
}

/**
 * 曲/アルバムを検索する。日本語楽曲に強い(lang=ja_jp)。
 * レート制限が毎分約20と厳しいため、MusicBrainzが薄い結果のときのみ呼ぶこと
 * (呼び出し側であるapi/search/music/route.tsでフォールバック判定する)。
 */
export async function searchItunes(query: string, entityType: ItunesEntityType, limit = 10): Promise<ItunesCandidate[]> {
  const url = new URL(ITUNES_SEARCH_BASE);
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", entityType === "song" ? "song" : "album");
  url.searchParams.set("lang", "ja_jp");
  url.searchParams.set("limit", String(limit));

  const res = await itunesFetch(url.toString());
  if (!res.ok) {
    throw new Error(`iTunes search failed: ${res.status}`);
  }
  const json: unknown = await res.json();
  const parsed = SearchResponseSchema.parse(json);
  return parsed.results
    .map((track) => toCandidate(track, entityType))
    .filter((c): c is ItunesCandidate => c !== null);
}

/**
 * クライアントが送ってきたtrackId/collectionIdを、iTunesへの再照会で検証する。
 * lookupはID完全一致のため、MusicBrainzのID直接照会と同じく間接照会は不要。
 */
export async function verifyById(id: string, entityType: ItunesEntityType): Promise<ItunesCandidate | null> {
  const url = new URL(ITUNES_LOOKUP_BASE);
  url.searchParams.set("id", id);

  const res = await itunesFetch(url.toString());
  if (!res.ok) {
    throw new Error(`iTunes lookup failed: ${res.status}`);
  }
  const json: unknown = await res.json();
  const parsed = SearchResponseSchema.parse(json);
  const track = parsed.results[0];
  if (!track) return null;
  return toCandidate(track, entityType);
}

/**
 * アルバム(collection)に収録された曲の長さを合計し、推定消費時間を算出する。
 * lookup APIにentity=songを付けると、先頭に collection 本体・以降に
 * その収録曲(track)が並んで返る仕様を利用する。
 *
 * 1曲でも長さ(trackTimeMillis)が欠落していれば合計を出さずnullを返す
 * (musicbrainz.tsのfetchReleaseGroupDurationMsと同じ考え方: 過小な
 * 合計値を確定した推定消費時間として提示しない)。
 */
export async function fetchAlbumDurationMs(collectionId: string): Promise<number | null> {
  const url = new URL(ITUNES_LOOKUP_BASE);
  url.searchParams.set("id", collectionId);
  url.searchParams.set("entity", "song");

  try {
    const res = await itunesFetch(url.toString());
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = SearchResponseSchema.parse(json);
    const tracks = parsed.results.filter((r) => r.wrapperType === "track");
    if (tracks.length === 0) return null;

    let totalMs = 0;
    for (const track of tracks) {
      if (track.trackTimeMillis === undefined) return null;
      totalMs += track.trackTimeMillis;
    }
    return totalMs;
  } catch {
    return null;
  }
}
