import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAccessToken,
  searchGames,
  verifyGameById,
  buildImageUrl,
  buildSourceUrl,
  buildRawFields,
  displayTitle,
  computeDuration,
  IgdbUnauthorizedError,
  IgdbRateLimitError,
  type IgdbCandidate,
} from "./igdb";

/** KVNamespaceの最小スタブ(rate-limit.test.tsと同じ方針) */
function createKvStub() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    } as unknown as KVNamespace,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function gameCandidate(overrides: Partial<IgdbCandidate> = {}): IgdbCandidate {
  return {
    source: "igdb",
    igdbId: 1942,
    title: "The Witcher 3: Wild Hunt",
    titleJa: null,
    coverImageId: "co1wyy",
    releaseDate: "2015-05-18",
    platforms: ["PC", "PlayStation 4"],
    slug: "the-witcher-3-wild-hunt",
    timeToBeatNormallySeconds: 172800,
    ...overrides,
  };
}

const SAMPLE_GAME = {
  id: 1942,
  name: "The Witcher 3: Wild Hunt",
  slug: "the-witcher-3-wild-hunt",
  cover: { image_id: "co1wyy" },
  first_release_date: 1431907200, // 2015-05-18(UTC)
  platforms: [{ name: "PC" }, { name: "PlayStation 4" }],
};

describe("getAccessToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("KVに既存トークンがあればそれを返し、Twitchへ問い合わせない", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "cached-token");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const token = await getAccessToken(kv, "client-id", "client-secret");

    expect(token).toBe("cached-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("KVに無ければTwitchへ発行リクエストし、KVに保存する", async () => {
    const { kv, store } = createKvStub();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "new-token", expires_in: 5000000, token_type: "bearer" }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await getAccessToken(kv, "client-id", "client-secret");

    expect(token).toBe("new-token");
    expect(store.get("igdb:access_token")).toBe("new-token");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("id.twitch.tv/oauth2/token");
    expect(url).toContain("client_id=client-id");
    expect(url).toContain("grant_type=client_credentials");
  });

  it("Twitchトークン発行が失敗したら、URL(client_secretを含む)を出さずにstatus/bodyのみログに残す", async () => {
    // client_secret誤り等の設定不備は、実際にはigdbFetch側ではなくここで
    // 最初に失敗する経路(2回目レビュー指摘)。ログにclient_secretが漏れないことも
    // あわせて検証する
    const { kv } = createKvStub();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response('{"message":"invalid client secret"}', { status: 403 })));

    await expect(getAccessToken(kv, "client-id", "super-secret-value")).rejects.toThrow("Twitch token request failed: 403");

    expect(errorSpy).toHaveBeenCalledWith(
      "[igdb] Twitchトークン発行に失敗しました",
      expect.objectContaining({ status: 403, body: '{"message":"invalid client secret"}' }),
    );
    const loggedArgs = JSON.stringify(errorSpy.mock.calls);
    expect(loggedArgs).not.toContain("super-secret-value");
    errorSpy.mockRestore();
  });

  it("保存するTTLは実際のexpires_inより安全マージン分短い(トークン失効前に削除させるため)", async () => {
    const { kv } = createKvStub();
    const putSpy = kv.put as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 5587808, token_type: "bearer" })),
    );

    await getAccessToken(kv, "client-id", "client-secret");

    const [, , opts] = putSpy.mock.calls[0];
    expect(opts.expirationTtl).toBeLessThan(5587808);
    expect(opts.expirationTtl).toBe(5587808 - 3 * 24 * 60 * 60);
  });
});

describe("searchGames", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("検索結果を正規化する(image_idはcover.urlではなくcover.image_idから取得)", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse([SAMPLE_GAME])));

    const results = await searchGames("witcher", kv, "client-id", "client-secret");

    expect(results).toEqual([
      {
        source: "igdb",
        igdbId: 1942,
        title: "The Witcher 3: Wild Hunt",
        titleJa: null,
        coverImageId: "co1wyy",
        releaseDate: "2015-05-18",
        platforms: ["PC", "PlayStation 4"],
        slug: "the-witcher-3-wild-hunt",
        timeToBeatNormallySeconds: null,
      },
    ]);
  });

  it("Client-IDヘッダとBearerトークンを付けてPOSTする(Apicalypseはクエリパラメータではなくボディ)", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await searchGames("witcher", kv, "client-id", "client-secret");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.igdb.com/v4/games");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ "Client-ID": "client-id", Authorization: "Bearer tok" });
    expect((init as RequestInit).body).toContain('search "witcher"');
    expect((init as RequestInit).body).toContain("where version_parent = null");
  });

  it("クエリ内のダブルクオートをエスケープする(Apicalypseの文字列リテラルを壊さないため)", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await searchGames('Half-Life "Alyx"', kv, "client-id", "client-secret");

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).body).toContain('search "Half-Life \\"Alyx\\""');
  });

  it("バックスラッシュを先にエスケープし、既存のバックスラッシュとの組み合わせで文字列リテラルから脱出できないようにする", async () => {
    // 「\"」を含む入力に対し、ダブルクオートだけをエスケープすると
    // 元のバックスラッシュ+新しいエスケープ文字で`\\"`という並びになり、
    // 標準的なエスケープ文法では`\\`が「エスケープされたバックスラッシュ」
    // として消費され、直後の`"`が終端してしまう。それを防げているか検証する
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await searchGames('foo\\" test', kv, "client-id", "client-secret");

    const [, init] = fetchMock.mock.calls[0];
    const body = (init as RequestInit).body as string;
    // search節の文字列リテラルは`search "..."`のペアで正しく閉じている必要がある。
    // 脱出できていれば、意図しない位置(where節等)にダブルクオートが混入する
    expect(body).toContain('search "foo\\\\\\" test"');
    // where version_parent = null 節が、注入によって壊れず1回だけ存在すること
    expect(body.match(/where version_parent = null/g)).toHaveLength(1);
  });

  it("coverがない作品もパースできる(画像未収録タイトル)", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse([{ ...SAMPLE_GAME, cover: null }])));

    const results = await searchGames("test", kv, "client-id", "client-secret");

    expect(results[0].coverImageId).toBeNull();
  });
});

describe("401の自動リトライ", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("1回目が401なら新規トークンを発行して自動的に1回だけリトライする", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "expired-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 })) // 検索リクエスト(古いトークン)
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-token", expires_in: 5000000, token_type: "bearer" })) // トークン再発行
      .mockResolvedValueOnce(jsonResponse([SAMPLE_GAME])); // 検索リクエスト(新トークンでリトライ)
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchGames("witcher", kv, "client-id", "client-secret");

    expect(results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // 2回目の検索リクエストは新しいトークンを使っている
    const retryInit = fetchMock.mock.calls[2][1] as RequestInit;
    expect((retryInit.headers as Record<string, string>).Authorization).toBe("Bearer fresh-token");
  });

  it("再発行後も401が続く場合はIgdbUnauthorizedErrorを投げ、無限ループしない", async () => {
    // client_secret失効・IGDB側障害等、トークン失効以外の原因を想定
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "expired-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 })) // 検索リクエスト
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-token", expires_in: 5000000, token_type: "bearer" })) // トークン再発行
      .mockResolvedValueOnce(new Response("", { status: 401 })); // リトライも401
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchGames("test", kv, "client-id", "client-secret")).rejects.toBeInstanceOf(IgdbUnauthorizedError);
    // 3回で打ち切られている(検索→再発行→リトライ検索)。無限ループしていないことの確認
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("429のレート制限", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("IgdbRateLimitErrorを投げる(IGDBはMALと異なり標準的な429を使う)", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 429 })));

    await expect(searchGames("test", kv, "client-id", "client-secret")).rejects.toBeInstanceOf(IgdbRateLimitError);
  });
});

describe("verifyGameById", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("ゲーム情報とtime_to_beatを両方取得して結合する", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([SAMPLE_GAME]))
      .mockResolvedValueOnce(jsonResponse([{ game_id: 1942, normally: 172800 }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyGameById(1942, kv, "client-id", "client-secret");

    expect(result).toMatchObject({ igdbId: 1942, timeToBeatNormallySeconds: 172800 });
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.igdb.com/v4/game_time_to_beats");
  });

  it("game_time_to_beatsが0件でも例外にせずtimeToBeatNormallySeconds=nullとして扱う(未収録タイトル)", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse([SAMPLE_GAME])).mockResolvedValueOnce(jsonResponse([])),
    );

    const result = await verifyGameById(1942, kv, "client-id", "client-secret");

    expect(result?.timeToBeatNormallySeconds).toBeNull();
  });

  it("game_time_to_beatsの取得自体が失敗してもゲーム追加は止めない", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse([SAMPLE_GAME])).mockResolvedValueOnce(new Response("", { status: 500 })),
    );

    const result = await verifyGameById(1942, kv, "client-id", "client-secret");

    expect(result).not.toBeNull();
    expect(result?.timeToBeatNormallySeconds).toBeNull();
  });

  it("該当ゲームが存在しない場合はnullを返す", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse([])));

    const result = await verifyGameById(999999999, kv, "client-id", "client-secret");

    expect(result).toBeNull();
  });
});

describe("buildImageUrl", () => {
  it("cover_big_2xサイズでURLを組み立てる", () => {
    expect(buildImageUrl("co1wyy")).toBe("https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1wyy.jpg");
  });
});

describe("buildSourceUrl", () => {
  it("slugがあればIGDB公式サイトのURLを組み立てる", () => {
    expect(buildSourceUrl({ slug: "the-witcher-3-wild-hunt" })).toBe("https://www.igdb.com/games/the-witcher-3-wild-hunt");
  });

  it("slugがなければnullを返す(数値IDでは正しいURLにならないため)", () => {
    expect(buildSourceUrl({ slug: null })).toBeNull();
  });
});

describe("buildRawFields", () => {
  it("保存するキーがホワイトリストと完全一致する", () => {
    expect(Object.keys(buildRawFields(gameCandidate())).sort()).toEqual(
      ["platforms", "releaseDate", "slug", "timeToBeatNormallySeconds", "title", "titleJa"].sort(),
    );
  });
});

describe("displayTitle", () => {
  it("titleJaがあればそれを優先する", () => {
    expect(displayTitle(gameCandidate({ title: "Elden Ring", titleJa: "エルデンリング" }))).toBe("エルデンリング");
  });

  it("titleJaがなければ元のtitleを使う", () => {
    expect(displayTitle(gameCandidate({ title: "Elden Ring", titleJa: null }))).toBe("Elden Ring");
  });
});

describe("日本語タイトルの選定(alternative_namesから)", () => {
  it("commentに'Japanese'を含み、実際に日本語文字を含む別名を採用する", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse([
          {
            ...SAMPLE_GAME,
            alternative_names: [
              { name: "The Witcher 3: Wild Hunt", comment: "Full title" },
              { name: "ウィッチャー3 ワイルドハント", comment: "Japanese title" },
            ],
          },
        ]),
      ),
    );

    const results = await searchGames("witcher", kv, "client-id", "client-secret");

    expect(results[0].titleJa).toBe("ウィッチャー3 ワイルドハント");
  });

  it("commentに'Japanese'を含んでいても、日本語文字を含まないローマ字表記は採用しない(Japanese title - romanization対策)", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse([
          {
            ...SAMPLE_GAME,
            alternative_names: [{ name: "Witcher 3 Wairudo Hanto", comment: "Japanese title - romanization" }],
          },
        ]),
      ),
    );

    const results = await searchGames("witcher", kv, "client-id", "client-secret");

    expect(results[0].titleJa).toBeNull();
  });

  it("alternative_namesが無ければtitleJaはnull", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse([{ ...SAMPLE_GAME, alternative_names: null }])));

    const results = await searchGames("witcher", kv, "client-id", "client-secret");

    expect(results[0].titleJa).toBeNull();
  });

  it("Japaneseと無関係な別名(略称等)は採用しない", async () => {
    const { kv, store } = createKvStub();
    store.set("igdb:access_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse([
          {
            ...SAMPLE_GAME,
            alternative_names: [{ name: "ウィッチャー3", comment: "Common abbreviation" }],
          },
        ]),
      ),
    );

    const results = await searchGames("witcher", kv, "client-id", "client-secret");

    expect(results[0].titleJa).toBeNull();
  });
});

describe("computeDuration", () => {
  it("normally(秒)をそのまま使う", () => {
    expect(computeDuration(gameCandidate({ timeToBeatNormallySeconds: 172800 }))).toEqual({
      estimatedSeconds: 172800,
      pending: 0,
      rawValue: "172800",
      rawUnit: "second",
    });
  });

  it("time_to_beatが未収録(null)ならpendingに倒す", () => {
    const result = computeDuration(gameCandidate({ timeToBeatNormallySeconds: null }));
    expect(result).toEqual({ estimatedSeconds: null, pending: 1, rawValue: null, rawUnit: null });
  });

  it("0以下の値もpendingに倒す", () => {
    expect(computeDuration(gameCandidate({ timeToBeatNormallySeconds: 0 })).pending).toBe(1);
  });
});
