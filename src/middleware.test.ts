import { describe, expect, it } from "vitest";
import { resolvePublicShelfRewritePath } from "./middleware";

describe("resolvePublicShelfRewritePath", () => {
  it("/@handleを/u/handleに変換する", () => {
    expect(resolvePublicShelfRewritePath("/@yoin_user")).toBe("/u/yoin_user");
  });

  it("/@handle/subtypeのようなネストしたパスも変換する", () => {
    expect(resolvePublicShelfRewritePath("/@yoin_user/book")).toBe("/u/yoin_user/book");
  });

  it("/@handle以外のパスはnull(rewriteしない)", () => {
    expect(resolvePublicShelfRewritePath("/")).toBeNull();
    expect(resolvePublicShelfRewritePath("/profile")).toBeNull();
    expect(resolvePublicShelfRewritePath("/search/book")).toBeNull();
  });

  it("@がパスの途中にある場合はマッチしない(先頭固定)", () => {
    expect(resolvePublicShelfRewritePath("/api/profile/@handle")).toBeNull();
  });

  it("空のhandle(/@のみ)はマッチしない", () => {
    // 正規表現の[^/]+は1文字以上を要求するため、"/@"だけでは候補にならない
    expect(resolvePublicShelfRewritePath("/@")).toBeNull();
  });

  // レビュー指摘: [^/]+はドット2連(パストラバーサル的な文字列)も拾って
  // しまうため、SAFE_HANDLE_SEGMENTで文字種を絞って弾くようにした
  it("ドットを含む文字列(パストラバーサル的な入力)はnull", () => {
    expect(resolvePublicShelfRewritePath("/@..")).toBeNull();
    expect(resolvePublicShelfRewritePath("/@foo.bar")).toBeNull();
  });

  it("21文字以上のhandleはnull(HANDLE_PATTERNの上限20文字に合わせた余裕)", () => {
    expect(resolvePublicShelfRewritePath(`/@${"a".repeat(21)}`)).toBeNull();
  });

  it("記号を含む文字列はnull", () => {
    expect(resolvePublicShelfRewritePath("/@foo/bar%00")).not.toBeNull(); // %00はrest側なのでhandle自体は安全
    expect(resolvePublicShelfRewritePath("/@foo bar")).toBeNull(); // スペースを含むhandle
    expect(resolvePublicShelfRewritePath("/@foo;rm")).toBeNull();
  });

  it("大文字混在・20文字以内の英数字とアンダースコアは許可する", () => {
    // 大文字小文字の正規化はfindUserByHandle側(normalizeHandle)で行うため、
    // ここでは弾かない
    expect(resolvePublicShelfRewritePath("/@YoinUser_1")).toBe("/u/YoinUser_1");
  });
});
