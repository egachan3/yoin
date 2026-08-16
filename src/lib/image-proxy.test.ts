import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCacheControl, buildR2Key, isValidVariant, serveWorkImage, type ImageSourceInfo } from "./image-proxy";

/** R2Bucketの最小スタブ */
function createR2Stub() {
  const store = new Map<string, { body: ArrayBuffer; httpMetadata?: R2HTTPMetadata }>();
  return {
    store,
    r2: {
      get: vi.fn(async (key: string) => {
        const obj = store.get(key);
        if (!obj) return null;
        return { body: obj.body, httpMetadata: obj.httpMetadata } as unknown as R2ObjectBody;
      }),
      put: vi.fn(async (key: string, value: ArrayBuffer, opts?: { httpMetadata?: R2HTTPMetadata }) => {
        store.set(key, { body: value, httpMetadata: opts?.httpMetadata });
      }),
    } as unknown as R2Bucket,
  };
}

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

/** waitUntilに渡された非同期処理を即座に待ち合わせるテスト用ヘルパー */
function createDeps(r2: R2Bucket, kv: KVNamespace) {
  const pending: Promise<unknown>[] = [];
  return {
    deps: { r2, kv, waitUntil: (p: Promise<unknown>) => pending.push(p) },
    flush: () => Promise.all(pending),
  };
}

function imageResponse(body = "fake-image-bytes", contentType = "image/jpeg", status = 200): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

describe("buildR2Key", () => {
  it("work_idとvariantを/で連結する(サイズトークンは含めない)", () => {
    expect(buildR2Key("abc-123", "grid")).toBe("abc-123/grid");
  });
});

describe("buildCacheControl", () => {
  it("TMDB由来はmax-ageが6ヶ月(15552000秒)未満になる", () => {
    const cc = buildCacheControl(true);
    const maxAge = Number(cc.match(/max-age=(\d+)/)?.[1]);
    expect(maxAge).toBeLessThan(6 * 30 * 24 * 60 * 60);
    expect(maxAge).toBeGreaterThan(0);
  });

  it("TMDB以外は1年(31536000秒)", () => {
    expect(buildCacheControl(false)).toBe("public, max-age=31536000, immutable");
  });
});

describe("isValidVariant", () => {
  it("gridのみ許可する(detailは詳細ページ未実装のため未対応)", () => {
    expect(isValidVariant("grid")).toBe(true);
    expect(isValidVariant("detail")).toBe(false);
    expect(isValidVariant("")).toBe(false);
  });
});

describe("serveWorkImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const source: ImageSourceInfo = { url: "https://cdn.example.com/cover.jpg", isTmdb: false };

  it("R2に既存の画像があればそれを返し、外部には一切問い合わせない", async () => {
    const { r2, store } = createR2Stub();
    const { kv } = createKvStub();
    store.set("work-1/grid", {
      body: new TextEncoder().encode("cached-bytes").buffer as ArrayBuffer,
      httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=100" },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { deps, flush } = createDeps(r2, kv);

    const res = await serveWorkImage(deps, "work-1", "grid", source);
    await flush();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=100");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("R2に無ければ外部から取得し、レスポンスを返しつつR2にも書き込む(遅延補充)", async () => {
    const { r2, store } = createR2Stub();
    const { kv } = createKvStub();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(imageResponse("fresh-bytes", "image/jpeg")));
    const { deps, flush } = createDeps(r2, kv);

    const res = await serveWorkImage(deps, "work-2", "grid", source);
    await flush();

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("fresh-bytes");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    // waitUntilで書き込みが完了している(flush後)
    expect(store.has("work-2/grid")).toBe(true);
  });

  it("TMDB由来の画像はCache-Controlのmax-ageが短い", async () => {
    const { r2 } = createR2Stub();
    const { kv } = createKvStub();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(imageResponse()));
    const { deps } = createDeps(r2, kv);

    const res = await serveWorkImage(deps, "work-tmdb", "grid", { url: "https://image.tmdb.org/x.jpg", isTmdb: true });

    const maxAge = Number(res.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1]);
    expect(maxAge).toBeLessThan(6 * 30 * 24 * 60 * 60);
  });

  it("negative cache中はR2もfetchも一切呼ばずただちに404を返す", async () => {
    const { r2 } = createR2Stub();
    const getSpy = r2.get as unknown as ReturnType<typeof vi.fn>;
    const { kv, store } = createKvStub();
    store.set("img-404:work-3", "1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { deps } = createDeps(r2, kv);

    const res = await serveWorkImage(deps, "work-3", "grid", source);

    expect(res.status).toBe(404);
    expect(getSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sourceがnull(DBにwork_idが無い/primary_image_refが無い)なら404を返しnegative cacheに乗せる", async () => {
    const { r2 } = createR2Stub();
    const { kv, store } = createKvStub();
    const { deps, flush } = createDeps(r2, kv);

    const res = await serveWorkImage(deps, "work-missing", "grid", null);
    await flush();

    expect(res.status).toBe(404);
    expect(store.has("img-404:work-missing")).toBe(true);
  });

  it("配信元が404を返したらnegative cacheに乗せる(書影未収録等、恒久的な可能性が高いため)", async () => {
    const { r2 } = createR2Stub();
    const { kv, store } = createKvStub();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })));
    const { deps, flush } = createDeps(r2, kv);

    const res = await serveWorkImage(deps, "work-4", "grid", source);
    await flush();

    expect(res.status).toBe(404);
    expect(store.has("img-404:work-4")).toBe(true);
  });

  it("配信元が5xx(一時障害)を返してもnegative cacheに乗せない(実際には画像が存在する可能性が高いため)", async () => {
    // !originRes.okで判定すると5xx/429/401/403も404と同じ扱いになり、
    // 配信元の一時障害だけで24時間「無い」扱いになってしまう(レビューで発見した不具合)
    const { r2 } = createR2Stub();
    const { kv, store } = createKvStub();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })));
    const { deps, flush } = createDeps(r2, kv);

    const res = await serveWorkImage(deps, "work-503", "grid", source);
    await flush();

    expect(res.status).toBe(404);
    expect(store.has("img-404:work-503")).toBe(false);
  });

  it("配信元が429(レート制限)を返してもnegative cacheに乗せない", async () => {
    const { r2 } = createR2Stub();
    const { kv, store } = createKvStub();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 429 })));
    const { deps, flush } = createDeps(r2, kv);

    const res = await serveWorkImage(deps, "work-429", "grid", source);
    await flush();

    expect(res.status).toBe(404);
    expect(store.has("img-404:work-429")).toBe(false);
  });

  it("配信元がタイムアウト・ネットワークエラーの場合はnegative cacheに乗せない(次回リトライさせる)", async () => {
    const { r2 } = createR2Stub();
    const { kv, store } = createKvStub();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network error")));
    const { deps, flush } = createDeps(r2, kv);

    const res = await serveWorkImage(deps, "work-5", "grid", source);
    await flush();

    expect(res.status).toBe(404);
    expect(store.has("img-404:work-5")).toBe(false);
  });

  it("配信元が画像以外のcontent-typeを返した場合は404にしてnegative cacheに乗せる", async () => {
    const { r2 } = createR2Stub();
    const { kv, store } = createKvStub();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(imageResponse("<html>oops</html>", "text/html")));
    const { deps, flush } = createDeps(r2, kv);

    const res = await serveWorkImage(deps, "work-6", "grid", source);
    await flush();

    expect(res.status).toBe(404);
    expect(store.has("img-404:work-6")).toBe(true);
  });

  it("image/svg+xmlはスクリプト埋め込みが可能なため拒否する(XSS対策)", async () => {
    const { r2 } = createR2Stub();
    const { kv, store } = createKvStub();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(imageResponse("<svg onload=\"alert(1)\"></svg>", "image/svg+xml")),
    );
    const { deps, flush } = createDeps(r2, kv);

    const res = await serveWorkImage(deps, "work-svg", "grid", source);
    await flush();

    expect(res.status).toBe(404);
    expect(store.has("img-404:work-svg")).toBe(true);
  });

  it("R2キャッシュ返却時・新規取得時のいずれもX-Content-Type-Options: nosniffを付与する", async () => {
    const { r2, store: r2Store } = createR2Stub();
    const { kv } = createKvStub();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(imageResponse("bytes", "image/jpeg")));
    const { deps } = createDeps(r2, kv);

    const fresh = await serveWorkImage(deps, "work-nosniff-1", "grid", source);
    expect(fresh.headers.get("X-Content-Type-Options")).toBe("nosniff");

    r2Store.set("work-nosniff-2/grid", {
      body: new TextEncoder().encode("cached").buffer as ArrayBuffer,
      httpMetadata: { contentType: "image/png" },
    });
    const cached = await serveWorkImage(deps, "work-nosniff-2", "grid", source);
    expect(cached.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("R2への書き込み失敗は握り潰し、ユーザーへのレスポンスには影響しない", async () => {
    const { r2 } = createR2Stub();
    (r2.put as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockRejectedValue(new Error("429"));
    const { kv } = createKvStub();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(imageResponse("bytes", "image/jpeg")));
    const { deps, flush } = createDeps(r2, kv);

    const res = await serveWorkImage(deps, "work-7", "grid", source);

    expect(res.status).toBe(200);
    await expect(flush()).resolves.toBeDefined();
  });
});
