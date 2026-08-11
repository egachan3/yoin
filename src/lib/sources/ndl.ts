// NDLサーチAPI(SRU)クライアント。書籍の検索・ISBN完全一致検索。
// 参照: shelf-type-app-spec.md セクション5.4「アプリ内検索のクエリ設計」
//       セクション5「書籍のdcterms:extentパース方針」

import { XMLParser } from "fast-xml-parser";

const NDL_SRU_BASE = "https://ndlsearch.ndl.go.jp/api/sru";

export interface NdlBookCandidate {
  ndlBibId: string;
  title: string;
  creator: string | null;
  publisher: string | null;
  /** ハイフン除去済み。Google Books側のisbn:クエリにそのまま渡せる */
  isbn: string | null;
  /** 例: "302p ; 15cm"。パース前の生の値をそのまま保持する */
  extentRaw: string | null;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function extractText(node: unknown): string | null {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node && typeof node === "object" && "#text" in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)["#text"]);
  }
  return null;
}

// テストのためexport(実際のAPIレスポンスから抽出した固定サンプルXMLで検証する)
export function parseBibResource(recordDataXml: string): NdlBookCandidate | null {
  const doc = parser.parse(recordDataXml) as Record<string, unknown>;
  const rdf = doc["rdf:RDF"] as Record<string, unknown> | undefined;
  if (!rdf) return null;

  const bibResources = toArray(rdf["dcndl:BibResource"] as Record<string, unknown> | Record<string, unknown>[]);

  // 1レコードに複数のBibResourceが含まれ得る(書誌情報用/所蔵情報用など)ため、
  // materialTypeが図書(Book)を指しているものだけを対象にする
  const bookResource = bibResources.find((res) => {
    const materialTypes = toArray(res["dcndl:materialType"] as Record<string, unknown> | Record<string, unknown>[]);
    return materialTypes.some((mt) => {
      const resource = mt?.["@_rdf:resource"];
      return typeof resource === "string" && resource.includes("/ndltype/Book");
    });
  });
  if (!bookResource) return null;

  const identifiers = toArray(
    bookResource["dcterms:identifier"] as Record<string, unknown> | Record<string, unknown>[],
  );
  let ndlBibId: string | null = null;
  let isbn: string | null = null;
  for (const id of identifiers) {
    const datatype = id?.["@_rdf:datatype"];
    const value = extractText(id);
    if (typeof datatype === "string" && datatype.endsWith("/NDLBibID")) {
      ndlBibId = value;
    }
    if (typeof datatype === "string" && datatype.endsWith("/ISBN") && value) {
      isbn = value.replace(/-/g, "");
    }
  }

  const title = extractText(bookResource["dcterms:title"]);
  const creatorAgent = (bookResource["dcterms:creator"] as Record<string, unknown> | undefined)?.[
    "foaf:Agent"
  ] as Record<string, unknown> | undefined;
  const creator = creatorAgent ? extractText(creatorAgent["foaf:name"]) : null;
  const publisherAgent = (bookResource["dcterms:publisher"] as Record<string, unknown> | undefined)?.[
    "foaf:Agent"
  ] as Record<string, unknown> | undefined;
  const publisher = publisherAgent ? extractText(publisherAgent["foaf:name"]) : null;
  const extentRaw = extractText(bookResource["dcterms:extent"]);

  if (!ndlBibId || !title) return null;

  return { ndlBibId, title, creator, publisher, isbn, extentRaw };
}

// NDLのtitle部分一致検索は、タイトルに入力文字列を含むだけの無関係な資料
// (曲名として同じ文字列を含む音楽アルバムの収録曲一覧など)を大量に拾う。
// materialType=Bookで絞ってもなお、目的の本が結果の後方に埋もれることがある
// (実データで確認: 「ノルウェイの森」で検索すると、Book種別だけに絞った上でも
// 目的の本は取得順で16件目)。取得件数を検索結果件数より多めに確保した上で、
// タイトル一致度でソートしてから返す。
const FETCH_MULTIPLIER = 3;

// テストのためexport
export function titleMatchScore(candidateTitle: string, query: string): number {
  const normalizedTitle = candidateTitle.normalize("NFKC");
  const normalizedQuery = query.normalize("NFKC");
  if (normalizedTitle === normalizedQuery) return 0;
  if (normalizedTitle.startsWith(normalizedQuery)) return 1;
  if (normalizedTitle.includes(normalizedQuery)) return 2;
  return 3;
}

interface SruSearchResult {
  candidates: NdlBookCandidate[];
  /** 次ページの取得に使うstartRecord。もう次がなければnull */
  nextStartRecord: number | null;
}

async function sruSearch(cql: string, fetchCount: number, startRecord: number): Promise<SruSearchResult> {
  const url = new URL(NDL_SRU_BASE);
  url.searchParams.set("operation", "searchRetrieve");
  // dpid=iss-ndl-opacで書誌本体の検索対象を国立国会図書館オンライン(図書)に絞る。
  // 絞らないと雑誌記事・音楽CD等が混在する(セクション5「NDLサーチAPI実データ調査」参照)
  url.searchParams.set("query", `${cql} AND dpid=iss-ndl-opac`);
  url.searchParams.set("recordSchema", "dcndl");
  url.searchParams.set("maximumRecords", String(fetchCount));
  url.searchParams.set("startRecord", String(startRecord));

  // NDLが応答しない/遅い場合にリクエストが張り付き続けないよう上限を設ける
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`NDL search failed: ${res.status}`);
  }
  const xml = await res.text();
  const doc = parser.parse(xml) as Record<string, unknown>;
  const searchResponse = doc["searchRetrieveResponse"] as Record<string, unknown> | undefined;
  const records = searchResponse?.["records"] as Record<string, unknown> | undefined;
  const recordList = toArray(records?.["record"] as Record<string, unknown> | Record<string, unknown>[]);
  const nextStartRecordRaw = extractText(searchResponse?.["nextRecordPosition"]);
  const nextStartRecord = nextStartRecordRaw ? Number(nextStartRecordRaw) : null;

  const candidates: NdlBookCandidate[] = [];
  for (const record of recordList) {
    const recordData = extractText(record["recordData"]);
    if (!recordData) continue;
    const parsed = parseBibResource(recordData);
    if (parsed) candidates.push(parsed);
  }
  return { candidates, nextStartRecord };
}

export type SearchField = "title" | "creator";

export interface SearchBooksResult {
  candidates: NdlBookCandidate[];
  /** 「もっと探す」で次に渡すトークン。nullなら次ページなし */
  nextStartRecord: number | null;
  /**
   * 実際に使われた検索フィールド。title検索が0件でcreatorにフォールバック
   * した場合は"creator"になる。「もっと探す」でstartRecordを渡し直す際は
   * このfieldも一緒に渡すこと。渡さないと2回目の呼び出しが常にtitle検索に
   * なり、creatorクエリの結果セット内の位置を全く別のtitleクエリに対して
   * 使うことになり不整合が起きる(レビューで発覚したバグ)。
   */
  field: SearchField;
}

/**
 * タイトル部分一致で検索し、0件ならcreator(著者名)部分一致にフォールバックする。
 * 完全一致 > 前方一致 > 部分一致の順にソートしてから先頭limit件を返す。
 *
 * NDLのtitle部分一致検索は関連度の低い資料も大量に拾うため(CQLのexact演算子も
 * 効果がないことを確認済み)、1回のAPI呼び出しでは目的の本が見つからないことが
 * ある。startRecordを指定して呼び直すと、続きの範囲から再度検索できる
 * (「もっと探す」ボタン用)。fieldを指定すると、そのフィールドで直接検索する
 * (「もっと探す」で継続する場合に使う。フォールバックは初回検索時のみ行う)。
 */
export async function searchBooks(
  query: string,
  limit = 10,
  startRecord = 1,
  field?: SearchField,
): Promise<SearchBooksResult> {
  const escaped = query.replace(/"/g, '\\"');
  const fetchCount = limit * FETCH_MULTIPLIER;

  let usedField: SearchField = field ?? "title";
  let result = await sruSearch(`${usedField}="${escaped}"`, fetchCount, startRecord);

  // フォールバックは「fieldが指定されていない初回検索」の場合のみ行う。
  // 「もっと探す」でfieldが明示されている場合は、そのフィールドのまま続ける
  if (result.candidates.length === 0 && field === undefined && startRecord === 1) {
    usedField = "creator";
    result = await sruSearch(`creator="${escaped}"`, fetchCount, startRecord);
  }

  const sorted = [...result.candidates].sort(
    (a, b) => titleMatchScore(a.title, query) - titleMatchScore(b.title, query),
  );
  return { candidates: sorted.slice(0, limit), nextStartRecord: result.nextStartRecord, field: usedField };
}

/**
 * ISBN完全一致検索。Amazon URLからのTier2解決やGoogle Books連携で使う。
 */
export async function findBookByIsbn(isbn: string): Promise<NdlBookCandidate | null> {
  const { candidates } = await sruSearch(`isbn="${isbn}"`, 1, 1);
  return candidates[0] ?? null;
}

/**
 * クライアントが検索結果からそのまま送ってきた書籍候補を、NDLへの再照会で
 * 検証する。ISBNがあればISBN完全一致で照会し、bibIdが一致すればその結果
 * (=NDLから取得し直した値)を正として返す。ISBNがない場合はtitleヒントで
 * 検索し、ndlBibIdが一致する候補を探す。どちらも見つからなければnull
 * (=クライアントの申告が信用できないため追加を拒否する)。
 *
 * NDL SRUはbibID単体でのクエリをサポートしない(`identifier="{id}"`は
 * illegal query syntaxで拒否されることを実際のAPIで確認済み)ため、
 * ISBNまたはtitleヒントを経由した間接的な再照会になる。
 */
export async function verifyBookCandidate(
  ndlBibId: string,
  titleHint: string,
  isbn: string | null,
): Promise<NdlBookCandidate | null> {
  if (isbn) {
    const byIsbn = await findBookByIsbn(isbn);
    return byIsbn && byIsbn.ndlBibId === ndlBibId ? byIsbn : null;
  }

  const { candidates } = await sruSearch(`title="${titleHint.replace(/"/g, '\\"')}"`, 50, 1);
  return candidates.find((c) => c.ndlBibId === ndlBibId) ?? null;
}
