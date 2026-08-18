import { describe, expect, it } from "vitest";
import { jstMonthRange, toJstDateKey } from "./jst-date";

describe("toJstDateKey", () => {
  it("UTC日中の時刻を日本時間の日付に変換する", () => {
    // 2026-08-18T03:00:00Z = 2026-08-18T12:00:00+09:00
    expect(toJstDateKey(Date.UTC(2026, 7, 18, 3, 0, 0) / 1000)).toBe("2026-08-18");
  });

  it("UTCでは前日深夜でも、日本時間では日付が繰り上がる境界を正しく扱う", () => {
    // 2026-08-17T15:00:00Z = 2026-08-18T00:00:00+09:00(JSTでの日付境界ちょうど)
    expect(toJstDateKey(Date.UTC(2026, 7, 17, 15, 0, 0) / 1000)).toBe("2026-08-18");
    // その1秒前はまだ2026-08-17
    expect(toJstDateKey(Date.UTC(2026, 7, 17, 14, 59, 59) / 1000)).toBe("2026-08-17");
  });

  it("月をまたぐ境界も正しい", () => {
    // 2026-08-31T15:00:00Z = 2026-09-01T00:00:00+09:00
    expect(toJstDateKey(Date.UTC(2026, 7, 31, 15, 0, 0) / 1000)).toBe("2026-09-01");
  });
});

describe("jstMonthRange", () => {
  it("月初の境界(JST 0:00)がstartと一致する", () => {
    const { start } = jstMonthRange(2026, 8);
    expect(toJstDateKey(start)).toBe("2026-08-01");
    // startの1秒前は7月末日のまま
    expect(toJstDateKey(start - 1)).toBe("2026-07-31");
  });

  it("endは翌月初(JST 0:00)で、月内の最終秒はend未満", () => {
    const { end } = jstMonthRange(2026, 8);
    expect(toJstDateKey(end)).toBe("2026-09-01");
    expect(toJstDateKey(end - 1)).toBe("2026-08-31");
  });

  it("12月は年をまたいでendを計算する", () => {
    const { end } = jstMonthRange(2026, 12);
    expect(toJstDateKey(end)).toBe("2027-01-01");
  });

  it("[start, end)の範囲がその月のすべての日を含み、他の月を含まない", () => {
    const { start, end } = jstMonthRange(2026, 2); // うるう年ではない2月
    const days = new Set<string>();
    for (let t = start; t < end; t += 3600) {
      days.add(toJstDateKey(t));
    }
    expect(days.size).toBe(28);
    expect([...days].sort()[0]).toBe("2026-02-01");
    expect([...days].sort().at(-1)).toBe("2026-02-28");
  });
});
