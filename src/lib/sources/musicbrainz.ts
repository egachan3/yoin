// MusicBrainz API + Cover Art Archiveクライアント。音楽の検索・ID直接照会・ジャケット取得。
// 参照: shelf-type-app-spec.md セクション3.2「音楽のデータソース選定」
//       セクション5.4「アプリ内検索のクエリ設計」

import { z } from "zod";

const MB_API_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";

// MusicBrainzは説明的なUser-Agentがないとリクエストを弾くことがあるため必須で付与する
// (公式ドキュメントのレート制限ガイドライン参照)
const USER_AGENT = "Yoin/0.1.0 (https://github.com/egachan3/yoin)";

async function mbFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
}

export type MusicEntityType = "recording" | "release-group";

export interface MusicCandidate {
  source: "musicbrainz";
  entityType: MusicEntityType;
  sourceId: string;
  title: string;
  artist: string | null;
  /** recordingのみ。release-groupはMusicBrainzの検索結果に曲単位の長さを持たないためnull */
  lengthMs: number | null;
  /**
   * recordingの場合のみ、ジャケット取得に使う代表releaseのMBID
   * (recordingそのものにはジャケットがなく、紐づくreleaseのCover Art Archiveを見に行く必要がある)
   */
  releaseIdForCoverArt: string | null;
}

const ArtistCreditSchema = z.array(z.object({ name: z.string() })).optional();

function joinArtistCredit(credit: z.infer<typeof ArtistCreditSchema>): string | null {
  if (!credit || credit.length === 0) return null;
  return credit.map((c) => c.name).join(", ");
}

const RecordingSchema = z.object({
  id: z.string(),
  title: z.string(),
  length: z.number().nullable().optional(),
  "artist-credit": ArtistCreditSchema,
  releases: z.array(z.object({ id: z.string() })).optional(),
});

const RecordingSearchResponseSchema = z.object({
  recordings: z.array(RecordingSchema).optional(),
  count: z.number(),
});

const ReleaseGroupSchema = z.object({
  id: z.string(),
  title: z.string(),
  "artist-credit": ArtistCreditSchema,
});

const ReleaseGroupSearchResponseSchema = z.object({
  "release-groups": z.array(ReleaseGroupSchema).optional(),
  count: z.number(),
});

function toRecordingCandidate(r: z.infer<typeof RecordingSchema>): MusicCandidate {
  return {
    source: "musicbrainz",
    entityType: "recording",
    sourceId: r.id,
    title: r.title,
    artist: joinArtistCredit(r["artist-credit"]),
    lengthMs: r.length ?? null,
    releaseIdForCoverArt: r.releases?.[0]?.id ?? null,
  };
}

function toReleaseGroupCandidate(rg: z.infer<typeof ReleaseGroupSchema>): MusicCandidate {
  return {
    source: "musicbrainz",
    entityType: "release-group",
    sourceId: rg.id,
    title: rg.title,
    artist: joinArtistCredit(rg["artist-credit"]),
    lengthMs: null,
    releaseIdForCoverArt: null,
  };
}

export interface MusicSearchResult {
  candidates: MusicCandidate[];
  /** 次ページ取得用のoffset。もう次がなければnull */
  nextOffset: number | null;
}

function escapeLuceneQuery(query: string): string {
  // MusicBrainzの検索クエリ(Lucene構文)で意味を持つ記号をエスケープする
  return query.replace(/([+\-!(){}[\]^"~*?:\\])/g, "\\$1");
}

/**
 * 曲(recording)を検索する。releaseも一緒に取得し(inc=releases)、
 * ジャケット取得用の代表release-idを候補に含める。
 */
export async function searchRecordings(query: string, limit = 10, offset = 0): Promise<MusicSearchResult> {
  const url = new URL(`${MB_API_BASE}/recording`);
  url.searchParams.set("query", escapeLuceneQuery(query));
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("inc", "releases");

  const res = await mbFetch(url.toString());
  if (!res.ok) {
    throw new Error(`MusicBrainz recording search failed: ${res.status}`);
  }
  const json: unknown = await res.json();
  const parsed = RecordingSearchResponseSchema.parse(json);
  const candidates = (parsed.recordings ?? []).map(toRecordingCandidate);
  // limit(要求件数)ではなくcandidates.length(実際に返ってきた件数)を基準に
  // 次のoffsetを計算する。要求件数より少ない件数しか返らなかった回があっても、
  // 未取得の候補を飛ばさない(NDLの「もっと探す」ページングバグと同種の問題を避ける。レビュー指摘)
  const nextOffset = offset + candidates.length < parsed.count ? offset + candidates.length : null;
  return { candidates, nextOffset };
}

/**
 * アルバム(release-group)を検索する。
 */
export async function searchReleaseGroups(query: string, limit = 10, offset = 0): Promise<MusicSearchResult> {
  const url = new URL(`${MB_API_BASE}/release-group`);
  url.searchParams.set("query", escapeLuceneQuery(query));
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  const res = await mbFetch(url.toString());
  if (!res.ok) {
    throw new Error(`MusicBrainz release-group search failed: ${res.status}`);
  }
  const json: unknown = await res.json();
  const parsed = ReleaseGroupSearchResponseSchema.parse(json);
  const candidates = (parsed["release-groups"] ?? []).map(toReleaseGroupCandidate);
  // limit(要求件数)ではなくcandidates.length(実際に返ってきた件数)を基準に
  // 次のoffsetを計算する。要求件数より少ない件数しか返らなかった回があっても、
  // 未取得の候補を飛ばさない(NDLの「もっと探す」ページングバグと同種の問題を避ける。レビュー指摘)
  const nextOffset = offset + candidates.length < parsed.count ? offset + candidates.length : null;
  return { candidates, nextOffset };
}

/**
 * クライアントが送ってきたrecording MBIDを、MusicBrainzへの再照会で検証する。
 * NDLと異なりMusicBrainzはID単体でのlookupをサポートするため、booksの
 * verifyBookCandidateのようなtitle経由の間接照会は不要(直接ID lookupが正)。
 */
export async function verifyRecordingById(mbid: string): Promise<MusicCandidate | null> {
  const url = new URL(`${MB_API_BASE}/recording/${encodeURIComponent(mbid)}`);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("inc", "artist-credits+releases");

  const res = await mbFetch(url.toString());
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`MusicBrainz recording lookup failed: ${res.status}`);
  }
  const json: unknown = await res.json();
  const parsed = RecordingSchema.safeParse(json);
  return parsed.success ? toRecordingCandidate(parsed.data) : null;
}

export async function verifyReleaseGroupById(mbid: string): Promise<MusicCandidate | null> {
  const url = new URL(`${MB_API_BASE}/release-group/${encodeURIComponent(mbid)}`);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("inc", "artist-credits");

  const res = await mbFetch(url.toString());
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`MusicBrainz release-group lookup failed: ${res.status}`);
  }
  const json: unknown = await res.json();
  const parsed = ReleaseGroupSchema.safeParse(json);
  return parsed.success ? toReleaseGroupCandidate(parsed.data) : null;
}

/**
 * Cover Art Archiveからジャケット画像URLを取得する。
 * 見つからない/取得失敗はnullを返す(呼び出し側で許容する設計、google-books.tsと同じ)。
 * サイズはgrid用途で500pxを使う(セクション5「Retina対応」の一段階大きいサイズの方針)。
 */
async function fetchCoverArt(kind: "release" | "release-group", mbid: string): Promise<string | null> {
  const url = `${CAA_BASE}/${kind}/${encodeURIComponent(mbid)}/front-500`;
  try {
    // HEADでリダイレクト先URLだけを読み取る。GETだと本文(画像バイナリ本体、
    // 数十〜数百KB)を取得してres.urlだけ見て捨てることになり無駄が大きい(レビュー指摘)
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000), redirect: "follow" });
    if (!res.ok) return null;
    return res.url;
  } catch {
    return null;
  }
}

export async function fetchCoverArtByReleaseGroup(mbid: string): Promise<string | null> {
  return fetchCoverArt("release-group", mbid);
}

export async function fetchCoverArtByRelease(mbid: string): Promise<string | null> {
  return fetchCoverArt("release", mbid);
}

const ReleaseGroupReleasesSchema = z.object({
  id: z.string(),
  "first-release-date": z.string().optional(),
  releases: z
    .array(
      z.object({
        id: z.string(),
        status: z.string().nullable().optional(),
        date: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

type ReleaseSummary = { id: string; status?: string | null; date?: string | null };

/**
 * release-groupの複数releaseから、収録曲ルックアップに使う代表release1枚を選ぶ。
 * 同じrelease-groupには「オリジナル盤」「デラックス版(ボーナストラック追加)」
 * 「後年のリマスター再発盤」等が並立し、単純に配列の先頭やstatus一致だけで選ぶと
 * ユーザーが想定する曲数・尺と食い違うリスクがある(レビュー指摘)。
 *
 * release-group自体が持つfirst-release-date(オリジナル発売日)と日付が一致する
 * Official releaseを最優先する。一致がなければOfficialの中で最も古い日付のもの、
 * それも無ければ先頭にフォールバックする。
 */
function pickRepresentativeRelease(
  releases: ReleaseSummary[],
  firstReleaseDate: string | undefined,
): ReleaseSummary | undefined {
  if (releases.length === 0) return undefined;

  const officials = releases.filter((r) => r.status === "Official");
  const pool = officials.length > 0 ? officials : releases;

  if (firstReleaseDate) {
    const exactMatch = pool.find((r) => r.date === firstReleaseDate);
    if (exactMatch) return exactMatch;
  }

  const dated = pool.filter((r): r is ReleaseSummary & { date: string } => !!r.date);
  if (dated.length > 0) {
    return dated.reduce((earliest, r) => (r.date < earliest.date ? r : earliest));
  }

  return pool[0];
}

const ReleaseTrackSchema = z.object({
  length: z.number().nullable().optional(),
  recording: z.object({ length: z.number().nullable().optional() }).optional(),
});

const ReleaseLookupSchema = z.object({
  id: z.string(),
  media: z.array(z.object({ tracks: z.array(ReleaseTrackSchema).optional() })).optional(),
});

/**
 * release-group(アルバム)に紐づく代表release1枚のtrack長を合計し、アルバムの
 * 推定消費時間を算出する。release-group自体は複数releaseを束ねる抽象概念で
 * トラック情報を持たないため、(1)releases一覧から代表releaseを選ぶ→
 * (2)そのreleaseのtrack長をinc=recordingsで取得、の2段階が必要。
 *
 * 代表releaseの選定はpickRepresentativeRelease参照。オリジナル発売日と一致する
 * Official releaseを優先し、リイシュー盤・デラックス版等と曲数が食い違う懸念を減らす。
 *
 * 1曲でも長さが不明(length欠落)なら合計を出さずnullを返す。過小な合計値を
 * 「確定した推定消費時間」として提示しないため(book-extentの1ページ非対応
 * トークン除外と同じ考え方: 不確実な値を確定値として出さない)。
 */
export async function fetchReleaseGroupDurationMs(mbid: string): Promise<number | null> {
  try {
    const rgUrl = new URL(`${MB_API_BASE}/release-group/${encodeURIComponent(mbid)}`);
    rgUrl.searchParams.set("fmt", "json");
    rgUrl.searchParams.set("inc", "releases");

    const rgRes = await mbFetch(rgUrl.toString());
    if (!rgRes.ok) return null;
    const rgJson: unknown = await rgRes.json();
    const rgParsed = ReleaseGroupReleasesSchema.safeParse(rgJson);
    if (!rgParsed.success) return null;

    const representativeRelease = pickRepresentativeRelease(
      rgParsed.data.releases ?? [],
      rgParsed.data["first-release-date"],
    );
    if (!representativeRelease) return null;

    const relUrl = new URL(`${MB_API_BASE}/release/${encodeURIComponent(representativeRelease.id)}`);
    relUrl.searchParams.set("fmt", "json");
    relUrl.searchParams.set("inc", "recordings");

    const relRes = await mbFetch(relUrl.toString());
    if (!relRes.ok) return null;
    const relJson: unknown = await relRes.json();
    const relParsed = ReleaseLookupSchema.safeParse(relJson);
    if (!relParsed.success) return null;

    const tracks = (relParsed.data.media ?? []).flatMap((m) => m.tracks ?? []);
    if (tracks.length === 0) return null;

    let totalMs = 0;
    for (const track of tracks) {
      const length = track.length ?? track.recording?.length ?? null;
      if (length === null) return null;
      totalMs += length;
    }
    return totalMs;
  } catch {
    return null;
  }
}
