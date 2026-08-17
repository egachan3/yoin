import { describe, expect, it } from "vitest";
import { chunk } from "./tmdb-refresh-producer";

// レビュー指摘(sendBatch()の1回100件上限)の回帰テスト。
// Cloudflare QueuesのsendBatch()は1回の呼び出しにつき最大100件までのため、
// enqueueDueTmdbRefreshesはこの関数でdue件数を100件ずつに分割して送信する。
describe("chunk", () => {
  it("空配列は空配列を返す", () => {
    expect(chunk([], 100)).toEqual([]);
  });

  it("サイズ未満の配列は1つのチャンクにまとまる", () => {
    expect(chunk([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });

  it("ちょうどサイズと同じ件数は1つのチャンクにまとまる", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    expect(chunk(items, 100)).toEqual([items]);
  });

  it("サイズを超える件数は複数チャンクに分割される(100件上限の回帰確認)", () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const result = chunk(items, 100);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(100);
    expect(result[1]).toHaveLength(100);
    expect(result[2]).toHaveLength(50);
    // 全件が過不足なく含まれる
    expect(result.flat()).toEqual(items);
  });

  it("サイズより1件だけ多い場合、2チャンクに分かれる(境界値)", () => {
    const items = Array.from({ length: 101 }, (_, i) => i);
    const result = chunk(items, 100);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(100);
    expect(result[1]).toHaveLength(1);
  });
});
