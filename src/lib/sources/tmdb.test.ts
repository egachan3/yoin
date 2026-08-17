import { afterEach, describe, expect, it, vi } from "vitest";
import { searchMovies, searchTv, verifyMovieById, verifyTvById, buildImageUrl } from "./tmdb";

const SAMPLE_MOVIE_SEARCH_ITEM = {
  id: 508947,
  title: "トップガン マーヴェリック",
  poster_path: "/abcdefg.jpg",
  release_date: "2022-05-27",
};

const SAMPLE_MOVIE_DETAIL = {
  ...SAMPLE_MOVIE_SEARCH_ITEM,
  runtime: 131,
};

const SAMPLE_TV_SEARCH_ITEM = {
  id: 508947, // 映画と同じ数値ID(採番空間が別であることの確認用)
  name: "サンプルドラマ",
  poster_path: "/hijklmn.jpg",
  first_air_date: "2020-01-01",
};

const SAMPLE_TV_DETAIL = {
  ...SAMPLE_TV_SEARCH_ITEM,
  episode_run_time: [45],
  number_of_episodes: 12,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("searchMovies / searchTv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("映画の検索結果を正規化する(runtimeMinutesは検索結果に含まれないためnull)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse({ results: [SAMPLE_MOVIE_SEARCH_ITEM] })),
    );

    const results = await searchMovies("トップガン", "dummy-key");

    expect(results).toEqual([
      {
        source: "tmdb",
        mediaType: "movie",
        tmdbId: 508947,
        title: "トップガン マーヴェリック",
        posterPath: "/abcdefg.jpg",
        releaseDate: "2022-05-27",
        runtimeMinutes: null,
        episodeRuntimeMinutes: null,
        numberOfEpisodes: null,
      },
    ]);
  });

  it("language=ja-JPとAPIキーをクエリに付与する", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchMovies("test", "my-api-key");

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("language")).toBe("ja-JP");
    expect(calledUrl.searchParams.get("api_key")).toBe("my-api-key");
  });

  it("ドラマの検索結果を正規化する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ results: [SAMPLE_TV_SEARCH_ITEM] })));

    const results = await searchTv("サンプル", "dummy-key");

    expect(results[0]).toMatchObject({
      source: "tmdb",
      mediaType: "tv",
      tmdbId: 508947,
      title: "サンプルドラマ",
    });
  });
});

describe("verifyMovieById / verifyTvById", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("映画のID直接lookupでruntimeMinutesを含む詳細を検証する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(SAMPLE_MOVIE_DETAIL)));

    const result = await verifyMovieById(508947, "dummy-key");

    expect(result?.runtimeMinutes).toBe(131);
  });

  it("ドラマのID直接lookupでepisodeRuntimeMinutes/numberOfEpisodesを含む詳細を検証する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(SAMPLE_TV_DETAIL)));

    const result = await verifyTvById(508947, "dummy-key");

    expect(result?.episodeRuntimeMinutes).toBe(45);
    expect(result?.numberOfEpisodes).toBe(12);
  });

  it("404の場合はnullを返す(存在しないtmdbId)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })));

    const result = await verifyMovieById(999999999, "dummy-key");

    expect(result).toBeNull();
  });

  it("episode_run_timeがnullで返っても検証は成功する(回帰テスト)", async () => {
    // TMDBが将来この値をnullで返すケースに備えた防御。ここでパースが失敗すると
    // 本来duration計算だけpending扱いにすべき場面がnot_foundエラーに化ける(レビュー指摘)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse({ ...SAMPLE_TV_DETAIL, episode_run_time: null })),
    );

    const result = await verifyTvById(508947, "dummy-key");

    expect(result).not.toBeNull();
    expect(result?.episodeRuntimeMinutes).toBeNull();
  });
});

describe("buildImageUrl", () => {
  it("w500サイズのURLを組み立てる", () => {
    expect(buildImageUrl("/abcdefg.jpg")).toBe("https://image.tmdb.org/t/p/w500/abcdefg.jpg");
  });
});
