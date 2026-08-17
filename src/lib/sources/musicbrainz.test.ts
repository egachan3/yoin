import { afterEach, describe, expect, it, vi } from "vitest";
import {
  searchRecordings,
  searchReleaseGroups,
  verifyRecordingById,
  verifyReleaseGroupById,
  fetchCoverArtByReleaseGroup,
  fetchCoverArtByRelease,
  fetchReleaseGroupDurationMs,
} from "./musicbrainz";

// 実際のMusicBrainz recording検索レスポンス形状を模したサンプル
function buildRecordingSearchResponse(count: number, recordings: unknown[]) {
  return JSON.stringify({ count, offset: 0, recordings });
}

function buildReleaseGroupSearchResponse(count: number, releaseGroups: unknown[]) {
  return JSON.stringify({ count, offset: 0, "release-groups": releaseGroups });
}

const SAMPLE_RECORDING = {
  id: "b9d9f7a1-0000-0000-0000-000000000001",
  title: "夜に駆ける",
  length: 261000,
  "artist-credit": [{ name: "YOASOBI" }],
  releases: [{ id: "release-mbid-001" }],
};

const SAMPLE_RELEASE_GROUP = {
  id: "c1d2e3f4-0000-0000-0000-000000000002",
  title: "THE BOOK",
  "artist-credit": [{ name: "YOASOBI" }],
};

describe("searchRecordings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recordingの検索結果を正規化する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(buildRecordingSearchResponse(1, [SAMPLE_RECORDING])));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchRecordings("夜に駆ける", 10, 0);

    expect(result.candidates).toEqual([
      {
        source: "musicbrainz",
        entityType: "recording",
        sourceId: "b9d9f7a1-0000-0000-0000-000000000001",
        title: "夜に駆ける",
        artist: "YOASOBI",
        lengthMs: 261000,
        releaseIdForCoverArt: "release-mbid-001",
      },
    ]);
    expect(result.nextOffset).toBeNull();
  });

  it("User-Agentヘッダーを付与する(MusicBrainzの要件)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(buildRecordingSearchResponse(0, [])));
    vi.stubGlobal("fetch", fetchMock);

    await searchRecordings("test", 10, 0);

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^Yoin\//);
  });

  it("結果件数がcountに満たない場合、nextOffsetを返す(もっと探す)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(buildRecordingSearchResponse(30, [SAMPLE_RECORDING])));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchRecordings("test", 10, 0);

    // limit(10)ではなく実際に返ってきた件数(1)を基準にoffsetを計算する
    // (要求件数より少ない件数しか返らない回があっても候補を飛ばさないため)
    expect(result.nextOffset).toBe(1);
  });
});

describe("searchReleaseGroups", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("release-groupの検索結果を正規化する(lengthMsは常にnull)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(buildReleaseGroupSearchResponse(1, [SAMPLE_RELEASE_GROUP])));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchReleaseGroups("THE BOOK", 10, 0);

    expect(result.candidates).toEqual([
      {
        source: "musicbrainz",
        entityType: "release-group",
        sourceId: "c1d2e3f4-0000-0000-0000-000000000002",
        title: "THE BOOK",
        artist: "YOASOBI",
        lengthMs: null,
        releaseIdForCoverArt: null,
      },
    ]);
  });
});

describe("verifyRecordingById / verifyReleaseGroupById", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("MBIDのID直接lookupで候補を検証する(NDLと異なりtitle経由の間接照会は不要)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(SAMPLE_RECORDING)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyRecordingById("b9d9f7a1-0000-0000-0000-000000000001");

    expect(result?.sourceId).toBe("b9d9f7a1-0000-0000-0000-000000000001");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("release-groupも同様にID直接lookupで検証する", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(SAMPLE_RELEASE_GROUP)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyReleaseGroupById("c1d2e3f4-0000-0000-0000-000000000002");

    expect(result?.sourceId).toBe("c1d2e3f4-0000-0000-0000-000000000002");
  });

  it("404の場合はnullを返す(存在しないMBID)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyRecordingById("存在しないid");

    expect(result).toBeNull();
  });
});

describe("Cover Art Archive", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("release-groupのジャケットを取得し、リダイレクト後の実URLを返す", async () => {
    // Response.urlはコンストラクタでは設定できない読み取り専用プロパティのため、
    // 実際のfetchによるリダイレクト追従を模してObject.definePropertyで設定する
    const redirectedUrl = "https://coverartarchive.org/some-actual-image-500.jpg";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        const res = new Response(null, { status: 200 });
        Object.defineProperty(res, "url", { value: redirectedUrl });
        return res;
      }),
    );

    const result = await fetchCoverArtByReleaseGroup("c1d2e3f4-0000-0000-0000-000000000002");

    expect(result).toBe(redirectedUrl);
  });

  it("見つからない場合(404)はnullを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })),
    );

    const result = await fetchCoverArtByRelease("release-mbid-001");

    expect(result).toBeNull();
  });

  it("ネットワークエラーはnullを返す(取得失敗を許容する)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("network error")),
    );

    const result = await fetchCoverArtByReleaseGroup("c1d2e3f4-0000-0000-0000-000000000002");

    expect(result).toBeNull();
  });
});

describe("fetchReleaseGroupDurationMs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function releaseGroupReleasesResponse(releases: unknown[]) {
    return JSON.stringify({ id: "rg-mbid", releases });
  }

  function releaseLookupResponse(media: unknown[]) {
    return JSON.stringify({ id: "release-mbid", media });
  }

  it("Officialステータスのreleaseを優先し、収録曲の長さを合計する", async () => {
    const fetchMock = vi
      .fn()
      // 1回目: release-group lookup(inc=releases)。Official以外が先に並ぶケース
      .mockResolvedValueOnce(
        new Response(
          releaseGroupReleasesResponse([
            { id: "bootleg-release", status: "Bootleg" },
            { id: "official-release", status: "Official" },
          ]),
        ),
      )
      // 2回目: 選ばれたofficial-releaseのtrack一覧
      .mockResolvedValueOnce(
        new Response(
          releaseLookupResponse([
            {
              tracks: [
                { length: 261000, recording: { length: 261000 } },
                { length: 200000, recording: { length: 200000 } },
              ],
            },
          ]),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReleaseGroupDurationMs("c1d2e3f4-0000-0000-0000-000000000002");

    expect(result).toBe(261000 + 200000);
    // 2回目の呼び出し先URLがofficial-releaseであることを確認
    const secondCallUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondCallUrl).toContain("official-release");
  });

  it("track.lengthが欠落していればrecording.lengthにフォールバックする", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(releaseGroupReleasesResponse([{ id: "release-1", status: "Official" }])))
      .mockResolvedValueOnce(
        new Response(releaseLookupResponse([{ tracks: [{ length: null, recording: { length: 180000 } }] }])),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReleaseGroupDurationMs("c1d2e3f4-0000-0000-0000-000000000002");

    expect(result).toBe(180000);
  });

  it("1曲でも長さが不明なら合計を出さずnullを返す(過小評価の回避)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(releaseGroupReleasesResponse([{ id: "release-1", status: "Official" }])))
      .mockResolvedValueOnce(
        new Response(
          releaseLookupResponse([
            { tracks: [{ length: 261000, recording: { length: 261000 } }, { length: null, recording: { length: null } }] },
          ]),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReleaseGroupDurationMs("c1d2e3f4-0000-0000-0000-000000000002");

    expect(result).toBeNull();
  });

  it("releaseが1件もなければnullを返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(releaseGroupReleasesResponse([]))));

    const result = await fetchReleaseGroupDurationMs("c1d2e3f4-0000-0000-0000-000000000002");

    expect(result).toBeNull();
  });

  it("ネットワークエラーはnullを返す(取得失敗を許容する)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network error")));

    const result = await fetchReleaseGroupDurationMs("c1d2e3f4-0000-0000-0000-000000000002");

    expect(result).toBeNull();
  });
});
