import { afterEach, describe, expect, it, vi } from "vitest";
import {
  searchAnime,
  searchManga,
  searchMal,
  verifyAnimeById,
  verifyMangaById,
  buildSourceId,
  buildSourceUrl,
  displayTitle,
  computeDuration,
  buildRawFields,
  MalForbiddenError,
  MalBadRequestError,
  type MalCandidate,
} from "./mal";

function animeCandidate(overrides: Partial<MalCandidate> = {}): MalCandidate {
  return {
    source: "mal",
    mediaType: "anime",
    malId: 51009,
    title: "Jujutsu Kaisen 2nd Season",
    titleJa: "呪術廻戦 第2期",
    mainPicture: null,
    startDate: "2023-07-06",
    numEpisodes: 23,
    averageEpisodeDurationSeconds: 1440,
    numVolumes: null,
    numChapters: null,
    ...overrides,
  };
}

function mangaCandidate(overrides: Partial<MalCandidate> = {}): MalCandidate {
  return {
    source: "mal",
    mediaType: "manga",
    malId: 113138,
    title: "Jujutsu Kaisen",
    titleJa: "呪術廻戦",
    mainPicture: null,
    startDate: "2018-03-05",
    numEpisodes: null,
    averageEpisodeDurationSeconds: null,
    numVolumes: 30,
    numChapters: 271,
    ...overrides,
  };
}

const SAMPLE_ANIME_NODE = {
  id: 51009,
  title: "Jujutsu Kaisen 2nd Season",
  alternative_titles: { ja: "呪術廻戦 第2期" },
  main_picture: { medium: "https://cdn.myanimelist.net/images/anime/medium.jpg", large: "https://cdn.myanimelist.net/images/anime/large.jpg" },
  start_date: "2023-07-06",
  num_episodes: 23,
  average_episode_duration: 1440, // 24分(秒単位)
};

const SAMPLE_MANGA_NODE = {
  id: 51009, // アニメと同じ数値ID(採番空間が別であることの確認用)
  title: "Jujutsu Kaisen",
  alternative_titles: { ja: "呪術廻戦" },
  main_picture: { medium: "https://cdn.myanimelist.net/images/manga/medium.jpg" },
  start_date: "2018-03-05",
  num_volumes: 30,
  num_chapters: 271,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("searchAnime / searchManga", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("アニメの検索結果を正規化する(秒単位のaverage_episode_durationをそのまま保持)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ data: [{ node: SAMPLE_ANIME_NODE }] })));

    const results = await searchAnime("呪術廻戦", "dummy-client-id");

    expect(results).toEqual([
      {
        source: "mal",
        mediaType: "anime",
        malId: 51009,
        title: "Jujutsu Kaisen 2nd Season",
        titleJa: "呪術廻戦 第2期",
        mainPicture: "https://cdn.myanimelist.net/images/anime/large.jpg",
        startDate: "2023-07-06",
        numEpisodes: 23,
        averageEpisodeDurationSeconds: 1440,
        numVolumes: null,
        numChapters: null,
      },
    ]);
  });

  it("マンガの検索結果を正規化する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ data: [{ node: SAMPLE_MANGA_NODE }] })));

    const results = await searchManga("呪術廻戦", "dummy-client-id");

    expect(results[0]).toMatchObject({
      mediaType: "manga",
      malId: 51009,
      titleJa: "呪術廻戦",
      numVolumes: 30,
      numChapters: 271,
      numEpisodes: null,
      averageEpisodeDurationSeconds: null,
    });
  });

  it("X-MAL-CLIENT-IDヘッダとfieldsを付けてリクエストする", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchAnime("呪術廻戦", "my-client-id");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/anime?");
    expect(url).toContain("q=%E5%91%AA%E8%A1%93%E5%BB%BB%E6%88%A6");
    expect(url).toContain("fields=");
    expect((init as RequestInit).headers).toEqual({ "X-MAL-CLIENT-ID": "my-client-id" });
  });

  it("synopsis/mean/rankといったユーザー生成コンテンツ由来のフィールドは、APIが返しても取り込まない", async () => {
    // spec 3.4: これらはMALユーザーの生成物の集約であり永続化しない。
    // MalCandidate型が持たないことをランタイムでも保証する
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              node: {
                ...SAMPLE_ANIME_NODE,
                synopsis: "あらすじ本文",
                mean: 8.7,
                rank: 12,
                popularity: 34,
                num_list_users: 56789,
              },
            },
          ],
        }),
      ),
    );

    const results = await searchAnime("呪術廻戦", "dummy-client-id");

    expect(results[0]).not.toHaveProperty("synopsis");
    expect(results[0]).not.toHaveProperty("mean");
    expect(results[0]).not.toHaveProperty("rank");
    expect(results[0]).not.toHaveProperty("popularity");
    expect(JSON.stringify(results[0])).not.toContain("あらすじ本文");
  });

  it("日本語タイトルがない作品でもtitleJa=nullとして扱える", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({ data: [{ node: { ...SAMPLE_ANIME_NODE, alternative_titles: {} } }] }),
      ),
    );

    const results = await searchAnime("test", "dummy-client-id");

    expect(results[0].titleJa).toBeNull();
  });

  it("main_pictureがnullでもパースできる(画像のない作品)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse({ data: [{ node: { ...SAMPLE_ANIME_NODE, main_picture: null } }] })),
    );

    const results = await searchAnime("test", "dummy-client-id");

    expect(results[0].mainPicture).toBeNull();
  });

  it("largeが無ければmediumにフォールバックする(large優先は上の正規化テストで検証済み)", async () => {
    // 棚グリッドはRetinaで実効280px以上必要でmedium(幅200px前後)だとぼやける
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          data: [{ node: { ...SAMPLE_ANIME_NODE, main_picture: { medium: "https://example.com/m.jpg" } } }],
        }),
      ),
    );

    const results = await searchAnime("test", "dummy-client-id");

    expect(results[0].mainPicture).toBe("https://example.com/m.jpg");
  });

  it("放送中の作品(num_episodes=0)もパースでき、0のまま返す", async () => {
    // 0をnullに潰さないこと。duration計算側でpendingに倒す判断をするため
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse({ data: [{ node: { ...SAMPLE_ANIME_NODE, num_episodes: 0 } }] })),
    );

    const results = await searchAnime("test", "dummy-client-id");

    expect(results[0].numEpisodes).toBe(0);
  });
});

describe("HTTPエラーの扱い", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("403はMalForbiddenErrorとして投げる(MALは429ではなく403で返すため)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 403 })));

    await expect(searchAnime("test", "dummy-client-id")).rejects.toBeInstanceOf(MalForbiddenError);
  });

  it("403以外のエラーは通常のErrorとして投げる", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 500 })));

    await expect(searchAnime("test", "dummy-client-id")).rejects.not.toBeInstanceOf(MalForbiddenError);
  });

  it("403のレスポンスボディを保持する(レート制限とClient ID無効の切り分けに要る)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response('{"error":"invalid_token"}', { status: 403 })),
    );

    await expect(searchAnime("test", "dummy-client-id")).rejects.toMatchObject({
      body: '{"error":"invalid_token"}',
    });
  });

  it("400はMalBadRequestErrorとして投げる(クエリ最小長の推定が外れた場合の受け皿)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 400 })));

    await expect(searchAnime("あ", "dummy-client-id")).rejects.toBeInstanceOf(MalBadRequestError);
  });
});

describe("searchMal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mediaTypeで指定された片方のみを1回だけ叩く(spec 5.4: 並列2本はレート制限に抵触する)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchMal("manga", "test", "dummy-client-id");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/manga?");
  });
});

describe("verifyAnimeById / verifyMangaById", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ID照会の結果を正規化して返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(SAMPLE_ANIME_NODE)));

    const result = await verifyAnimeById(51009, "dummy-client-id");

    expect(result).toMatchObject({ mediaType: "anime", malId: 51009, numEpisodes: 23 });
  });

  it("404はnullを返す(存在しないIDが送られてきた場合)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 404 })));

    expect(await verifyMangaById(999999999, "dummy-client-id")).toBeNull();
  });

  it("スキーマに合わないレスポンスはnullを返す(例外にしない)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ unexpected: true })));

    expect(await verifyAnimeById(51009, "dummy-client-id")).toBeNull();
  });
});

describe("buildSourceId / buildSourceUrl / displayTitle", () => {
  it("アニメとマンガで同じ数値IDでも異なるsource_idになる(採番空間が別のため)", () => {
    const animeSourceId = buildSourceId({ mediaType: "anime", malId: 51009 });
    const mangaSourceId = buildSourceId({ mediaType: "manga", malId: 51009 });

    expect(animeSourceId).toBe("anime:51009");
    expect(mangaSourceId).toBe("manga:51009");
    expect(animeSourceId).not.toBe(mangaSourceId);
  });

  it("来歴URLをmediaTypeに応じて組み立てる", () => {
    expect(buildSourceUrl({ mediaType: "anime", malId: 51009 })).toBe("https://myanimelist.net/anime/51009");
    expect(buildSourceUrl({ mediaType: "manga", malId: 113138 })).toBe("https://myanimelist.net/manga/113138");
  });

  it("日本語タイトルがあれば優先し、なければ既定タイトルを使う", () => {
    expect(displayTitle({ title: "Jujutsu Kaisen", titleJa: "呪術廻戦" })).toBe("呪術廻戦");
    expect(displayTitle({ title: "Jujutsu Kaisen", titleJa: null })).toBe("Jujutsu Kaisen");
    // 空白のみの日本語タイトルは実質ないものとして扱う
    expect(displayTitle({ title: "Jujutsu Kaisen", titleJa: "   " })).toBe("Jujutsu Kaisen");
  });
});

describe("buildRawFields", () => {
  it("保存するキーがホワイトリストと完全一致する(規約上NGなフィールドが混ざらない)", () => {
    // spec 3.4: synopsis/mean/rank/popularityはUGCの集約であり永続化しない。
    // spec 5.4「強制手段はコードレビュー運用に頼らない」ため、キー集合を固定して
    // フィールドを足したときに必ずこのテストが落ちるようにする
    expect(Object.keys(buildRawFields(animeCandidate())).sort()).toEqual(
      [
        "averageEpisodeDurationSeconds",
        "mediaType",
        "numChapters",
        "numEpisodes",
        "numVolumes",
        "startDate",
        "title",
        "titleJa",
      ].sort(),
    );
  });

  it("APIの余計なフィールドが候補に紛れ込んでいてもraw_fieldsには出ない", () => {
    const contaminated = { ...animeCandidate(), synopsis: "あらすじ本文", mean: 8.7 } as MalCandidate;

    expect(JSON.stringify(buildRawFields(contaminated))).not.toContain("あらすじ本文");
    expect(buildRawFields(contaminated)).not.toHaveProperty("mean");
  });
});

describe("computeDuration", () => {
  it("アニメ: average_episode_duration(秒) × num_episodes で秒を算出する", () => {
    // 24分(1440秒) × 23話 = 33120秒
    expect(computeDuration(animeCandidate())).toEqual({
      estimatedSeconds: 33120,
      pending: 0,
      rawValue: JSON.stringify({ averageEpisodeDurationSeconds: 1440, numEpisodes: 23 }),
      rawUnit: "second_per_episode",
    });
  });

  it("アニメ: 放送中(num_episodes=0)はpendingに倒す", () => {
    // 「値が無い」ではなく「将来埋まり得る」区分にする(spec 10)。
    // 0を掛けて0秒として確定させると、完結後も0のまま集計に載ってしまう
    const result = computeDuration(animeCandidate({ numEpisodes: 0 }));
    expect(result).toEqual({ estimatedSeconds: null, pending: 1, rawValue: null, rawUnit: null });
  });

  it("アニメ: average_episode_durationが欠落している場合もpendingに倒す", () => {
    expect(computeDuration(animeCandidate({ averageEpisodeDurationSeconds: null })).pending).toBe(1);
    expect(computeDuration(animeCandidate({ averageEpisodeDurationSeconds: 0 })).pending).toBe(1);
  });

  it("マンガ: num_volumes × 20分 で秒を算出する(spec 10の決定値)", () => {
    // 30巻 × 20分 × 60 = 36000秒
    expect(computeDuration(mangaCandidate())).toEqual({
      estimatedSeconds: 36000,
      pending: 0,
      rawValue: "30",
      rawUnit: "volume",
    });
  });

  it("マンガ: 連載中(num_volumes=0)はpendingに倒し、num_chaptersでは代替しない", () => {
    // num_chaptersがあってもフォールバックしない。話数あたりの読了時間には
    // 根拠がなく、当て推量になるため(spec 10)
    const result = computeDuration(mangaCandidate({ numVolumes: 0, numChapters: 271 }));
    expect(result).toEqual({ estimatedSeconds: null, pending: 1, rawValue: null, rawUnit: null });
  });
});
