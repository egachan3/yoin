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
});
