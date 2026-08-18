import { describe, expect, it } from "vitest";
import type { ShelfEntryRow } from "@/db/shelf";
import { buildCalendarMonth } from "./calendar";

function makeEntry(id: string, addedAt: number): ShelfEntryRow {
  return {
    id,
    status: "completed",
    comment: null,
    rating: null,
    added_at: addedAt,
    catalog_id: `catalog-${id}`,
    genre: "book",
    subtype: "book",
    title: `title-${id}`,
    primary_image_ref: null,
    owner_user_id: null,
  };
}

describe("buildCalendarMonth", () => {
  it("月の日数を正しく求める(30日の月・31日の月・うるう年でない2月)", () => {
    expect(buildCalendarMonth(2026, 4, []).days).toHaveLength(30);
    expect(buildCalendarMonth(2026, 8, []).days).toHaveLength(31);
    expect(buildCalendarMonth(2026, 2, []).days).toHaveLength(28);
  });

  it("うるう年の2月は29日になる", () => {
    expect(buildCalendarMonth(2028, 2, []).days).toHaveLength(29);
  });

  it("月初の曜日(leadingBlanks)を正しく求める(2026-08-01は土曜)", () => {
    // Date.UTC(2026,7,1).getUTCDay()を検算: 実際に土曜であることが前提
    const month = buildCalendarMonth(2026, 8, []);
    expect(new Date(Date.UTC(2026, 7, 1)).getUTCDay()).toBe(month.leadingBlanks);
  });

  it("エントリを日本時間の日付ごとに正しく振り分ける", () => {
    const entries = [
      makeEntry("1", Date.UTC(2026, 7, 18, 3, 0, 0) / 1000), // JST 8/18 12:00
      makeEntry("2", Date.UTC(2026, 7, 17, 15, 0, 0) / 1000), // JST 8/18 00:00(境界)
      makeEntry("3", Date.UTC(2026, 7, 20, 3, 0, 0) / 1000), // JST 8/20
    ];
    const month = buildCalendarMonth(2026, 8, entries);

    const day18 = month.days.find((d) => d.date === 18);
    const day20 = month.days.find((d) => d.date === 20);
    const day19 = month.days.find((d) => d.date === 19);

    expect(day18?.entries.map((e) => e.id).sort()).toEqual(["1", "2"]);
    expect(day20?.entries.map((e) => e.id)).toEqual(["3"]);
    expect(day19?.entries).toEqual([]);
  });

  it("範囲外(前月・翌月)の日付を渡しても、その月のdaysには現れない", () => {
    // jstMonthRangeで絞り込み済みの前提だが、念のため月境界のズレに強いことを確認
    const entries = [
      makeEntry("prev", Date.UTC(2026, 6, 31, 10, 0, 0) / 1000), // JST 7/31
      makeEntry("next", Date.UTC(2026, 8, 1, 10, 0, 0) / 1000), // JST 9/1
    ];
    const month = buildCalendarMonth(2026, 8, entries);
    const totalEntries = month.days.reduce((sum, d) => sum + d.entries.length, 0);
    expect(totalEntries).toBe(0);
  });

  it("dateKeyがYYYY-MM-DD形式でゼロパディングされる", () => {
    const month = buildCalendarMonth(2026, 2, []);
    expect(month.days[0].dateKey).toBe("2026-02-01");
  });
});
