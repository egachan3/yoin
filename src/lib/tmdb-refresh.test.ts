import { describe, expect, it } from "vitest";
import {
  jitterDays,
  refetchDueAt,
  hardDeadlineAt,
  isDueForRefetch,
  isPastHardDeadline,
  parseTmdbSourceId,
  REFETCH_START_DAYS,
  HARD_DEADLINE_DAYS,
} from "./tmdb-refresh";

const DAY = 24 * 60 * 60;

describe("jitterDays", () => {
  it("常に-7〜7の範囲を返す", () => {
    for (const id of ["a", "b", "01a00bd8-cb67-758b-8544-15663a3efcc4", "", "z".repeat(50)]) {
      const jitter = jitterDays(id);
      expect(jitter).toBeGreaterThanOrEqual(-7);
      expect(jitter).toBeLessThanOrEqual(7);
    }
  });

  it("同じIDには常に同じ値を返す(決定的)", () => {
    const id = "01a00bd8-cb67-758b-8544-15663a3efcc4";
    expect(jitterDays(id)).toBe(jitterDays(id));
  });

  it("異なるIDは(概ね)異なる値になりうる", () => {
    const values = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(jitterDays));
    expect(values.size).toBeGreaterThan(1);
  });
});

describe("refetchDueAt / hardDeadlineAt", () => {
  it("refetchDueAtはジッター込みで158〜172日目の範囲に収まる", () => {
    const cachedAt = 1_700_000_000;
    for (const id of ["a", "b", "c", "d", "e"]) {
      const due = refetchDueAt(cachedAt, id);
      const daysFromCache = (due - cachedAt) / DAY;
      expect(daysFromCache).toBeGreaterThanOrEqual(REFETCH_START_DAYS - 7);
      expect(daysFromCache).toBeLessThanOrEqual(REFETCH_START_DAYS + 7);
    }
  });

  it("hardDeadlineAtはジッターなしで正確に180日後", () => {
    const cachedAt = 1_700_000_000;
    expect(hardDeadlineAt(cachedAt)).toBe(cachedAt + HARD_DEADLINE_DAYS * DAY);
  });

  it("hardDeadlineAtはrefetchDueAtより常に後になる(グレース期間が必ず存在する)", () => {
    const cachedAt = 1_700_000_000;
    for (const id of ["a", "b", "c", "d", "e"]) {
      expect(hardDeadlineAt(cachedAt)).toBeGreaterThan(refetchDueAt(cachedAt, id));
    }
  });
});

describe("isDueForRefetch / isPastHardDeadline", () => {
  const cachedAt = 1_700_000_000;
  const id = "test-id";
  const due = refetchDueAt(cachedAt, id);
  const deadline = hardDeadlineAt(cachedAt);

  it("予定日より前はfalse", () => {
    expect(isDueForRefetch(cachedAt, id, due - 1)).toBe(false);
  });

  it("予定日以降はtrue", () => {
    expect(isDueForRefetch(cachedAt, id, due)).toBe(true);
  });

  it("ハード期限より前はfalse", () => {
    expect(isPastHardDeadline(cachedAt, deadline - 1)).toBe(false);
  });

  it("ハード期限以降はtrue", () => {
    expect(isPastHardDeadline(cachedAt, deadline)).toBe(true);
  });
});

describe("parseTmdbSourceId", () => {
  it("movie:123を正しくパースする", () => {
    expect(parseTmdbSourceId("movie:123")).toEqual({ mediaType: "movie", tmdbId: 123 });
  });

  it("tv:456を正しくパースする", () => {
    expect(parseTmdbSourceId("tv:456")).toEqual({ mediaType: "tv", tmdbId: 456 });
  });

  it.each([
    ["invalid:123", "不正なmediaType"],
    ["movie:abc", "数値でないID"],
    ["movie:0", "0以下のID"],
    ["movie:-1", "負のID"],
    ["movie", "コロンがない"],
    ["", "空文字列"],
  ])("%s (%s) はnullを返す", (input) => {
    expect(parseTmdbSourceId(input)).toBeNull();
  });
});
