import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBibResource, titleMatchScore, verifyBookCandidate } from "./ndl";

// 実際のNDLサーチAPIレスポンス(isbn=9784062748681)から採取した書誌情報。
// タグ構造・データ形式が変わっていないかを検知するための固定サンプル。
const NOROUEI_NO_MORI_XML = `
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcndl="http://ndl.go.jp/dcndl/terms/" xmlns:foaf="http://xmlns.com/foaf/0.1/" xmlns:owl="http://www.w3.org/2002/07/owl#">
  <dcndl:BibResource rdf:about="https://ndlsearch.ndl.go.jp/books/R100000002-I000007489542#material">
    <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/JPNO">20667205</dcterms:identifier>
    <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/NDLBibID">7489542</dcterms:identifier>
    <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/ISBN">4-06-274868-1</dcterms:identifier>
    <dcterms:title>ノルウェイの森. 上</dcterms:title>
    <dcterms:creator><foaf:Agent rdf:about="http://id.ndl.go.jp/auth/entity/00104237">
      <foaf:name>村上, 春樹, 1949-</foaf:name>
    </foaf:Agent></dcterms:creator>
    <dcterms:publisher><foaf:Agent>
      <foaf:name>講談社</foaf:name>
    </foaf:Agent></dcterms:publisher>
    <dcterms:extent>302p ; 15cm</dcterms:extent>
    <dcndl:materialType rdf:resource="http://ndl.go.jp/ndltype/Book" rdfs:label="図書"/>
  </dcndl:BibResource>
</rdf:RDF>
`;

// 共著のサンプル(isbn=9784478025819「嫌われる勇気」)。dcterms:creatorが
// 複数出現する場合、fast-xml-parserは配列として返す。単一オブジェクト前提で
// 実装すると値を取りこぼす(実際にE2E確認で発覚したバグの回帰テスト)
const CO_AUTHORED_XML = `
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcndl="http://ndl.go.jp/dcndl/terms/" xmlns:foaf="http://xmlns.com/foaf/0.1/">
  <dcndl:BibResource rdf:about="https://ndlsearch.ndl.go.jp/books/R100000002-I000025056492#material">
    <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/NDLBibID">25056492</dcterms:identifier>
    <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/ISBN">978-4-478-02581-9</dcterms:identifier>
    <dcterms:title>嫌われる勇気 : 自己啓発の源流「アドラー」の教え</dcterms:title>
    <dcterms:creator><foaf:Agent>
      <foaf:name>岸見, 一郎</foaf:name>
    </foaf:Agent></dcterms:creator><dcterms:creator><foaf:Agent>
      <foaf:name>古賀, 史健</foaf:name>
    </foaf:Agent></dcterms:creator>
    <dcterms:publisher><foaf:Agent>
      <foaf:name>ダイヤモンド社</foaf:name>
    </foaf:Agent></dcterms:publisher>
    <dcterms:extent>294p ; 19cm</dcterms:extent>
    <dcndl:materialType rdf:resource="http://ndl.go.jp/ndltype/Book" rdfs:label="図書"/>
  </dcndl:BibResource>
</rdf:RDF>
`;

// materialTypeがBook以外(音楽CD)のサンプル。書籍以外を検索結果から除外できるかの確認用
const MUSIC_CD_XML = `
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcndl="http://ndl.go.jp/dcndl/terms/" xmlns:foaf="http://xmlns.com/foaf/0.1/">
  <dcndl:BibResource rdf:about="https://ndlsearch.ndl.go.jp/books/R100000002-I000008907069#material">
    <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/NDLBibID">8907069</dcterms:identifier>
    <dcterms:title>イージーリスニング全曲集(1)</dcterms:title>
    <dcterms:extent>録音ディスク 2枚 : CD ; 12cm</dcterms:extent>
    <dcndl:materialType rdf:resource="http://ndl.go.jp/ndltype/Music" rdfs:label="音楽"/>
  </dcndl:BibResource>
</rdf:RDF>
`;

describe("parseBibResource", () => {
  it("Book種別の書誌情報を正しく抽出する", () => {
    const result = parseBibResource(NOROUEI_NO_MORI_XML);
    expect(result).toEqual({
      ndlBibId: "7489542",
      title: "ノルウェイの森. 上",
      creator: "村上, 春樹, 1949-",
      publisher: "講談社",
      isbn: "4062748681", // ハイフンが除去されている
      extentRaw: "302p ; 15cm",
    });
  });

  it("共著の場合、複数のcreatorを連結して抽出する(回帰テスト)", () => {
    const result = parseBibResource(CO_AUTHORED_XML);
    expect(result?.creator).toBe("岸見, 一郎, 古賀, 史健");
    expect(result?.publisher).toBe("ダイヤモンド社");
  });

  it("Book以外(音楽等)はnullを返す", () => {
    expect(parseBibResource(MUSIC_CD_XML)).toBeNull();
  });

  it("BibResourceを含まないXMLはnullを返す", () => {
    expect(parseBibResource("<rdf:RDF></rdf:RDF>")).toBeNull();
  });
});

// sruSearch()が受け取る実際のSRU封筒(searchRetrieveResponse)を模したXMLを組み立てる。
// recordDataの中身は実APIと同じくHTMLエンティティでエスケープする必要がある
// (fast-xml-parserが外側をパースする際、テキストノードとしてデコードされて
// 初めて内側のRDF/XMLとして扱える)
function escapeForRecordData(xml: string): string {
  return xml.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSruResponse(records: string[], nextStartRecord: number | null): string {
  const recordsXml = records
    .map(
      (r) =>
        `<record><recordSchema>info:srw/schema/1/dc-v1.1</recordSchema><recordPacking>string</recordPacking><recordData>${escapeForRecordData(r)}</recordData></record>`,
    )
    .join("");
  const nextTag = nextStartRecord !== null ? `<nextRecordPosition>${nextStartRecord}</nextRecordPosition>` : "";
  return `<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><version>1.2</version><numberOfRecords>${records.length}</numberOfRecords>${nextTag}<records>${recordsXml}</records></searchRetrieveResponse>`;
}

describe("verifyBookCandidate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ISBNなしの場合、1ページ目に見つからなくても複数ページ辿って照合する(回帰テスト)", async () => {
    // 1ページ目には目的の本(25056492)が含まれず、2ページ目で見つかるシナリオ。
    // 修正前は先頭50件(=1ページ目)しか見ていなかったため、このケースは
    // not_found(null)を返してしまっていた
    const page1 = buildSruResponse([NOROUEI_NO_MORI_XML], 51);
    const page2 = buildSruResponse([CO_AUTHORED_XML], null);

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(page1)).mockResolvedValueOnce(new Response(page2));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyBookCandidate("25056492", "嫌われる勇気", null);

    expect(result?.ndlBibId).toBe("25056492");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 2回目の呼び出しがstartRecord=51(1回目のnextRecordPosition)を
    // 引き継いでいることを確認する
    const secondCallUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(secondCallUrl.searchParams.get("startRecord")).toBe("51");
  });

  it("3ページ探しても見つからなければnullを返し、4回目は呼ばない(上限の確認)", async () => {
    const pageWithoutMatch = buildSruResponse([NOROUEI_NO_MORI_XML], 999);
    // Response.text()は一度しか読めないため、呼び出しのたびに新しいResponseを生成する
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(pageWithoutMatch)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyBookCandidate("存在しないbibId", "何か", null);

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ISBNがあればtitleヒントを使わずISBN完全一致のみで照合する", async () => {
    const isbnResponse = buildSruResponse([NOROUEI_NO_MORI_XML], null);
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(isbnResponse));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyBookCandidate("7489542", "全く関係ないタイトル", "4062748681");

    expect(result?.ndlBibId).toBe("7489542");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("query")).toContain("isbn=");
  });
});

describe("titleMatchScore", () => {
  it("完全一致は0", () => {
    expect(titleMatchScore("ノルウェイの森", "ノルウェイの森")).toBe(0);
  });

  it("前方一致は1", () => {
    expect(titleMatchScore("ノルウェイの森. 上", "ノルウェイの森")).toBe(1);
  });

  it("部分一致は2", () => {
    expect(titleMatchScore("音楽家たちの村上春樹 : ノルウェイの森と10のオマージュ", "ノルウェイの森")).toBe(2);
  });

  it("不一致は3", () => {
    expect(titleMatchScore("嫌われる勇気", "ノルウェイの森")).toBe(3);
  });

  it("全角/半角の違いを吸収する(NFKC正規化)", () => {
    expect(titleMatchScore("ABC123", "ＡＢＣ１２３")).toBe(0);
  });
});
