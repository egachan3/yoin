import { describe, expect, it } from "vitest";
import { parseManualDate } from "./manual-entry";

describe("parseManualDate", () => {
  it("正しい日付をUNIX秒(UTC深夜0時)に変換する", () => {
    expect(parseManualDate("2026-08-17")).toBe(Date.UTC(2026, 7, 17) / 1000);
  });

  it("うるう年の2/29を受け付ける", () => {
    expect(parseManualDate("2024-02-29")).toBe(Date.UTC(2024, 1, 29) / 1000);
  });

  it("西暦0〜99年を1900年代と誤解釈しない(Date.UTCの二桁年特別扱いのバグ回帰)", () => {
    // Date.UTC(50, 0, 1)は仕様上西暦1950年になってしまうため、期待値の算出にも使えない。
    // setUTCFullYearなら二桁年の特別扱いがないため、期待値の算出にも同じ手段を使う
    const expected = new Date(0);
    expected.setUTCFullYear(50, 0, 1);
    expect(parseManualDate("0050-01-01")).toBe(expected.getTime() / 1000);
    expect(parseManualDate("0050-01-01")).not.toBe(Date.UTC(1950, 0, 1) / 1000);
  });

  it.each([
    ["2026-02-30", "存在しない日付(繰り上がり)"],
    ["2026-13-01", "存在しない月"],
    ["2026/08/17", "区切り文字が不正"],
    ["26-08-17", "年が4桁でない"],
    ["", "空文字列"],
    ["not-a-date", "数値でない"],
  ])("%s (%s) はnullを返す", (input) => {
    expect(parseManualDate(input)).toBeNull();
  });
});
