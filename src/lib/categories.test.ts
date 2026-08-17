import { describe, expect, it } from "vitest";
import {
  SUBTYPE_LABELS,
  SUBTYPE_ORDER,
  SUBTYPE_SEARCH_PATH,
  SUBTYPE_TO_GENRE,
  aspectRatioFor,
  isSubtype,
} from "./categories";

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
