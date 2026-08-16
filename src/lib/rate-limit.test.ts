import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "./rate-limit";

/** KVNamespaceの最小スタブ。checkRateLimitが使うget/putのみ実装する */
function createKvStub() {
  const store = new Map<string, string>();
  const puts: { key: string; value: string; expirationTtl?: number }[] = [];
  return {
    store,
    puts,
    kv: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
        store.set(key, value);
        puts.push({ key, value, expirationTtl: opts?.expirationTtl });
      }),
    } as unknown as KVNamespace,
  };
}

const OPTIONS = { windowSeconds: 60, maxRequests: 3 };

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("上限までは許可し、超えたら拒否する", async () => {
    const { kv } = createKvStub();

    expect(await checkRateLimit(kv, "mal", "user-1", OPTIONS)).toBe(true);
    expect(await checkRateLimit(kv, "mal", "user-1", OPTIONS)).toBe(true);
    expect(await checkRateLimit(kv, "mal", "user-1", OPTIONS)).toBe(true);
    expect(await checkRateLimit(kv, "mal", "user-1", OPTIONS)).toBe(false);
  });

  it("ユーザーごとに枠が独立している", async () => {
    const { kv } = createKvStub();

    for (let i = 0; i < OPTIONS.maxRequests; i++) {
      await checkRateLimit(kv, "mal", "user-1", OPTIONS);
    }

    expect(await checkRateLimit(kv, "mal", "user-1", OPTIONS)).toBe(false);
    expect(await checkRateLimit(kv, "mal", "user-2", OPTIONS)).toBe(true);
  });

  it("窓をまたぐとリセットされる(固定窓)", async () => {
    const { kv } = createKvStub();

    for (let i = 0; i < OPTIONS.maxRequests; i++) {
      await checkRateLimit(kv, "mal", "user-1", OPTIONS);
    }
    expect(await checkRateLimit(kv, "mal", "user-1", OPTIONS)).toBe(false);

    vi.advanceTimersByTime(60_000);

    expect(await checkRateLimit(kv, "mal", "user-1", OPTIONS)).toBe(true);
  });

  it("窓の途中で使い続けてもTTLが延長されない(スライディング窓になっていない)", async () => {
    // 単一キーにexpirationTtlを付け直す実装だと、リクエストのたびに窓が
    // 後ろへずれ、「まとめて棚に入れる」ような正常な連続操作で上限に達した後
    // 無操作にならない限り解除されなくなる。キーに時刻バケットを含めることで
    // それを防いでいることを検証する
    const { kv } = createKvStub();

    await checkRateLimit(kv, "mal", "user-1", OPTIONS);
    vi.advanceTimersByTime(30_000);
    await checkRateLimit(kv, "mal", "user-1", OPTIONS);
    vi.advanceTimersByTime(30_000); // 最初のリクエストから60秒 = 次の窓

    // 直前(30秒前)にリクエストしていても、窓が変わればリセットされる
    expect(await checkRateLimit(kv, "mal", "user-1", OPTIONS)).toBe(true);
    expect(await checkRateLimit(kv, "mal", "user-1", OPTIONS)).toBe(true);
    expect(await checkRateLimit(kv, "mal", "user-1", OPTIONS)).toBe(true);
    expect(await checkRateLimit(kv, "mal", "user-1", OPTIONS)).toBe(false);
  });

  it("上限到達時は書き込まない(putするとTTLが延びて窓が明けなくなる)", async () => {
    const { kv, puts } = createKvStub();

    for (let i = 0; i < OPTIONS.maxRequests; i++) {
      await checkRateLimit(kv, "mal", "user-1", OPTIONS);
    }
    const putsBefore = puts.length;

    await checkRateLimit(kv, "mal", "user-1", OPTIONS);

    expect(puts.length).toBe(putsBefore);
  });

  it("キープレフィックスが違えば枠も別になる", async () => {
    const { kv } = createKvStub();

    for (let i = 0; i < OPTIONS.maxRequests; i++) {
      await checkRateLimit(kv, "mal", "user-1", OPTIONS);
    }

    expect(await checkRateLimit(kv, "mal", "user-1", OPTIONS)).toBe(false);
    expect(await checkRateLimit(kv, "other", "user-1", OPTIONS)).toBe(true);
  });
});
