import { describe, expect, it } from "vitest";
import { parseBibResource, titleMatchScore } from "./ndl";

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

  it("Book以外(音楽等)はnullを返す", () => {
    expect(parseBibResource(MUSIC_CD_XML)).toBeNull();
  });

  it("BibResourceを含まないXMLはnullを返す", () => {
    expect(parseBibResource("<rdf:RDF></rdf:RDF>")).toBeNull();
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
