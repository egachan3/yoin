import { describe, expect, it } from "vitest";
import { estimateReadingSeconds, parsePageCount } from "./book-extent";

// 仕様書(shelf-type-app-spec.md セクション5)に記載された全実例を固定化する。
// 将来の正規表現調整で気づかずに壊すのを防ぐ(レビュー指摘)。
describe("parsePageCount", () => {
  it.each([
    ["302p ; 15cm", 302],
    ["163,14p ; 15cm", 163],
    ["554p ; 20cm", 554],
    ["190p ; 18cm", 190],
    ["１４５ｐ ; ２０ｃｍ", 145],
    ["録音ディスク 2枚 (88分) : CD", null],
    ["スコア 6 p, パート譜 5枚 ; 30 cm", null],
    ["3冊", null],
    ["3冊 505p, 480p, 512p", null],
    [null, null],
  ])("parsePageCount(%j) === %j", (input, expected) => {
    expect(parsePageCount(input)).toBe(expected);
  });
});

describe("estimateReadingSeconds", () => {
  it("1ページ=1分で秒数を算出する", () => {
    expect(estimateReadingSeconds(302)).toBe(302 * 60);
  });

  it("ページ数がnullならnullを返す", () => {
    expect(estimateReadingSeconds(null)).toBeNull();
  });
});
