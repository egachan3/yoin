import { describe, expect, it } from "vitest";
import { parseManualDate, isCompletedStatus } from "./manual-entry";

describe("parseManualDate", () => {
  it("正しい日付をUNIX秒(UTC深夜0時)に変換する", () => {
    expect(parseManualDate("2026-08-17")).toBe(Date.UTC(2026, 7, 17) / 1000);
  });

  it("うるう年の2/29を受け付ける", () => {
    expect(parseManualDate("2024-02-29")).toBe(Date.UTC(2024, 1, 29) / 1000);
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

describe("isCompletedStatus", () => {
  it("completedのみtrueを返す", () => {
    expect(isCompletedStatus("completed")).toBe(true);
    expect(isCompletedStatus("planned")).toBe(false);
    expect(isCompletedStatus("in_progress")).toBe(false);
    expect(isCompletedStatus("on_hold")).toBe(false);
    expect(isCompletedStatus("dropped")).toBe(false);
  });
});
