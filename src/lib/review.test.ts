import { describe, expect, it } from "vitest";
import { COMMENT_MAX_LENGTH, ReviewFieldsSchema, normalizeReviewFields, parseReviewFieldsFromFormData } from "./review";

describe("normalizeReviewFields", () => {
	it("ratingが未指定ならnullにする", () => {
		expect(normalizeReviewFields({})).toEqual({ rating: null, comment: null });
	});

	it("commentの前後の空白をtrimする", () => {
		expect(normalizeReviewFields({ comment: "  よかった  " })).toEqual({ rating: null, comment: "よかった" });
	});

	it("空白のみのcommentはnullにする", () => {
		expect(normalizeReviewFields({ comment: "   " })).toEqual({ rating: null, comment: null });
	});

	it("ratingとcommentをそのまま保持する", () => {
		expect(normalizeReviewFields({ rating: 4, comment: "良かった" })).toEqual({ rating: 4, comment: "良かった" });
	});
});

describe("parseReviewFieldsFromFormData", () => {
	it("ratingが数字文字列なら数値に変換する", () => {
		const formData = new FormData();
		formData.set("rating", "3");
		expect(parseReviewFieldsFromFormData(formData).rating).toBe(3);
	});

	it("ratingが未設定ならnullにする", () => {
		const formData = new FormData();
		expect(parseReviewFieldsFromFormData(formData).rating).toBeNull();
	});

	it("ratingが数値でない文字列ならnullにする", () => {
		const formData = new FormData();
		formData.set("rating", "abc");
		expect(parseReviewFieldsFromFormData(formData).rating).toBeNull();
	});

	it("commentをそのまま文字列として取り出す", () => {
		const formData = new FormData();
		formData.set("comment", "感想テキスト");
		expect(parseReviewFieldsFromFormData(formData).comment).toBe("感想テキスト");
	});
});

describe("ReviewFieldsSchema", () => {
	it("範囲外のratingを拒否する", () => {
		expect(ReviewFieldsSchema.safeParse({ rating: 6 }).success).toBe(false);
		expect(ReviewFieldsSchema.safeParse({ rating: 0 }).success).toBe(false);
	});

	it(`${COMMENT_MAX_LENGTH}文字を超えるcommentを拒否する`, () => {
		const tooLong = "あ".repeat(COMMENT_MAX_LENGTH + 1);
		expect(ReviewFieldsSchema.safeParse({ comment: tooLong }).success).toBe(false);
	});

	it(`${COMMENT_MAX_LENGTH}文字ちょうどのcommentは許可する`, () => {
		const maxLength = "あ".repeat(COMMENT_MAX_LENGTH);
		expect(ReviewFieldsSchema.safeParse({ comment: maxLength }).success).toBe(true);
	});

	it("両方省略した空オブジェクトを許可する", () => {
		expect(ReviewFieldsSchema.safeParse({}).success).toBe(true);
	});
});
