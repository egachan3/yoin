import { afterEach, describe, expect, it, vi } from "vitest";
import { searchItunes, verifyById } from "./itunes";

const SAMPLE_TRACK = {
  wrapperType: "track",
  trackId: 1234567890,
  trackName: "夜に駆ける",
  trackTimeMillis: 261000,
  artistName: "YOASOBI",
  // artworkUrl100等はあえて含める(実際のAPIレスポンスを模す)。
  // パース後にこれらのフィールドが結果に含まれないことを確認するのが
  // このテストの主眼(Promo Content規約によりアートワークは使用しない)
  artworkUrl100: "https://example.com/artwork.jpg",
};

const SAMPLE_COLLECTION = {
  wrapperType: "collection",
  collectionId: 9876543210,
  collectionName: "THE BOOK",
  artistName: "YOASOBI",
  artworkUrl100: "https://example.com/artwork.jpg",
};

function buildSearchResponse(results: unknown[]) {
  return JSON.stringify({ resultCount: results.length, results });
}

describe("searchItunes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("曲の検索結果を正規化し、artworkUrl系フィールドを結果に含めない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(buildSearchResponse([SAMPLE_TRACK]))));

    const results = await searchItunes("夜に駆ける", "song");

    expect(results).toEqual([
      {
        source: "itunes",
        entityType: "song",
        sourceId: "1234567890",
        title: "夜に駆ける",
        artist: "YOASOBI",
        lengthMs: 261000,
      },
    ]);
    // 型レベルでartworkUrl等を持てない設計だが、実行時にも混入していないことを
    // 明示的に確認する
    expect(results[0]).not.toHaveProperty("artworkUrl100");
  });

  it("アルバムの検索結果を正規化する(lengthMsは常にnull)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(buildSearchResponse([SAMPLE_COLLECTION]))));

    const results = await searchItunes("THE BOOK", "album");

    expect(results).toEqual([
      {
        source: "itunes",
        entityType: "album",
        sourceId: "9876543210",
        title: "THE BOOK",
        artist: "YOASOBI",
        lengthMs: null,
      },
    ]);
  });

  it("lang=ja_jpパラメータを付与する(日本語楽曲対応)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(buildSearchResponse([])));
    vi.stubGlobal("fetch", fetchMock);

    await searchItunes("test", "song");

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("lang")).toBe("ja_jp");
  });
});

describe("verifyById", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("trackIdのID直接lookupで候補を検証する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(buildSearchResponse([SAMPLE_TRACK]))));

    const result = await verifyById("1234567890", "song");

    expect(result?.sourceId).toBe("1234567890");
  });

  it("trackのIDをentityType:albumで照会した場合はnullを返す(type confusion対策の回帰テスト)", async () => {
    // trackオブジェクトは自身が属するアルバムのcollectionId/collectionNameも
    // 保持するため、wrapperTypeを確認しないと「曲のIDをアルバムとして申告した
    // 不正なリクエスト」でもそのトラックが属するアルバム情報にすり替わって
    // 検証を通過してしまう(レビュー指摘)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(buildSearchResponse([SAMPLE_TRACK]))));

    const result = await verifyById("1234567890", "album");

    expect(result).toBeNull();
  });

  it("collectionのIDをentityType:songで照会した場合はnullを返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(buildSearchResponse([SAMPLE_COLLECTION]))));

    const result = await verifyById("9876543210", "song");

    expect(result).toBeNull();
  });

  it("見つからない場合はnullを返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(buildSearchResponse([]))));

    const result = await verifyById("存在しないid", "song");

    expect(result).toBeNull();
  });
});
