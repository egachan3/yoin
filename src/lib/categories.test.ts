import { describe, expect, it } from "vitest";
import type { ShelfEntryRow, CategoryCountRow } from "@/db/shelf";
import {
  SUBTYPE_LABELS,
  SUBTYPE_ORDER,
  SUBTYPE_SEARCH_PATH,
  SUBTYPE_TO_GENRE,
  aspectRatioFor,
  isSubtype,
  summarizeByCategory,
} from "./categories";

// summarizeByCategoryのテスト用に、実際のクエリ結果から必要なフィールドだけを
// 埋めた最小限のダミー行を作る
function makeEntry(overrides: Partial<ShelfEntryRow> & Pick<ShelfEntryRow, "id" | "subtype">): ShelfEntryRow {
  return {
    status: "completed",
    comment: null,
    rating: null,
    added_at: 0,
    catalog_id: `catalog-${overrides.id}`,
    genre: SUBTYPE_TO_GENRE[overrides.subtype],
    title: `title-${overrides.id}`,
    primary_image_ref: null,
    owner_user_id: null,
    ...overrides,
  };
}

describe("isSubtype", () => {
  it("8カテゴリはすべて受け入れる", () => {
    for (const subtype of SUBTYPE_ORDER) {
      expect(isSubtype(subtype)).toBe(true);
    }
  });

  it("Objectのプロトタイプ由来のキーを弾く(回帰テスト)", () => {
    // `value in SUBTYPE_LABELS`で判定していた頃は、プロトタイプチェーンまで
    // 辿ってしまいこれらがすべてsubtypeとして通っていた。手動追加APIの
    // バリデーションを突破し、D1のbind()が型エラーで落ちて502になる経路があった
    expect(isSubtype("constructor")).toBe(false);
    expect(isSubtype("toString")).toBe(false);
    expect(isSubtype("valueOf")).toBe(false);
    expect(isSubtype("__proto__")).toBe(false);
    expect(isSubtype("hasOwnProperty")).toBe(false);
  });

  it("文字列以外・未知の値を弾く", () => {
    expect(isSubtype(null)).toBe(false);
    expect(isSubtype(undefined)).toBe(false);
    expect(isSubtype(123)).toBe(false);
    expect(isSubtype("movie_tv")).toBe(false); // genreの語彙はsubtypeではない
    expect(isSubtype("")).toBe(false);
  });
});

describe("カテゴリ定義の一貫性", () => {
  // カテゴリを増減した際に、どれか1つのマップだけ更新し忘れる事故を防ぐ。
  // Recordの型でもある程度防げるが、SUBTYPE_ORDERは配列なので型では守れない
  it("SUBTYPE_ORDERが8カテゴリすべてを重複なく含む", () => {
    expect(SUBTYPE_ORDER).toHaveLength(8);
    expect(new Set(SUBTYPE_ORDER).size).toBe(8);
    expect([...SUBTYPE_ORDER].sort()).toEqual(Object.keys(SUBTYPE_LABELS).sort());
  });

  it("全カテゴリにラベル・genre・検索パスが定義されている", () => {
    for (const subtype of SUBTYPE_ORDER) {
      expect(SUBTYPE_LABELS[subtype]).toBeTruthy();
      expect(SUBTYPE_TO_GENRE[subtype]).toBeTruthy();
      expect(SUBTYPE_SEARCH_PATH[subtype]).toMatch(/^\/search\//);
    }
  });

  it("検索パスが重複しない(2カテゴリが同じ画面に潰れていない)", () => {
    const paths = SUBTYPE_ORDER.map((s) => SUBTYPE_SEARCH_PATH[s]);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("subtypeからのgenre導出が、DBのCHECK制約が許す5値に収まる", () => {
    const allowed = new Set(["book", "music", "movie_tv", "anime_manga", "game"]);
    for (const subtype of SUBTYPE_ORDER) {
      expect(allowed.has(SUBTYPE_TO_GENRE[subtype])).toBe(true);
    }
  });
});

describe("summarizeByCategory", () => {
  it("複数subtypeが混在した入力を正しく束ねる", () => {
    const entries = [
      makeEntry({ id: "1", subtype: "book" }),
      makeEntry({ id: "2", subtype: "album" }),
      makeEntry({ id: "3", subtype: "book" }),
    ];
    const counts: CategoryCountRow[] = [
      { subtype: "book", count: 2 },
      { subtype: "album", count: 1 },
    ];

    const result = summarizeByCategory(entries, counts);

    expect(result.map((c) => c.subtype)).toEqual(["book", "album"]); // SUBTYPE_ORDER順
    expect(result.find((c) => c.subtype === "book")?.recentEntries.map((e) => e.id)).toEqual(["1", "3"]);
  });

  it("recentEntriesは先頭3件に切る(4件目以降は積まない)", () => {
    const entries = [
      makeEntry({ id: "1", subtype: "book" }),
      makeEntry({ id: "2", subtype: "book" }),
      makeEntry({ id: "3", subtype: "book" }),
      makeEntry({ id: "4", subtype: "book" }),
    ];
    const counts: CategoryCountRow[] = [{ subtype: "book", count: 4 }];

    const result = summarizeByCategory(entries, counts);

    expect(result[0].recentEntries).toHaveLength(3);
    expect(result[0].recentEntries.map((e) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("件数はcounts(LIMIT無し)を正とし、entries(直近100件)の件数とは独立する", () => {
    // 1カテゴリに大量登録され、他カテゴリがLIMIT 100の外に押し出された状況を模す。
    // entriesにはgameが1件も含まれないが、countsには50件と記録されている
    const entries = [makeEntry({ id: "1", subtype: "book" })];
    const counts: CategoryCountRow[] = [
      { subtype: "book", count: 100 },
      { subtype: "game", count: 50 },
    ];

    const result = summarizeByCategory(entries, counts);

    // gameのカードは消えず、件数も正しく出る(画像だけが空になる)
    const game = result.find((c) => c.subtype === "game");
    expect(game?.count).toBe(50);
    expect(game?.recentEntries).toEqual([]);
  });

  it("countsに存在しないカテゴリ(0件)はカードを出さない", () => {
    const entries: ShelfEntryRow[] = [];
    const counts: CategoryCountRow[] = [];

    expect(summarizeByCategory(entries, counts)).toEqual([]);
  });

  it("countの型がstring/bigintで返ってもnumberに正規化する(D1ドライバ差異への耐性)", () => {
    const entries = [makeEntry({ id: "1", subtype: "book" })];
    const counts = [{ subtype: "book", count: "3" }] as unknown as CategoryCountRow[];

    const result = summarizeByCategory(entries, counts);

    expect(result[0].count).toBe(3);
    expect(typeof result[0].count).toBe("number");
  });
});

describe("aspectRatioFor", () => {
  it("アルバムと曲だけ正方形になる", () => {
    expect(aspectRatioFor("album")).toBe("1 / 1");
    expect(aspectRatioFor("song")).toBe("1 / 1");
  });

  it("それ以外は2:3(書影・ポスターの通例)", () => {
    for (const subtype of SUBTYPE_ORDER) {
      if (subtype === "album" || subtype === "song") continue;
      expect(aspectRatioFor(subtype)).toBe("2 / 3");
    }
  });
});
