import { z } from "zod";

export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const COMMENT_MAX_LENGTH = 50;

// 追加時に星評価・感想を受け取る全APIで共通のスキーマ。両方とも任意項目
export const ReviewFieldsSchema = z.object({
	rating: z.number().int().min(RATING_MIN).max(RATING_MAX).nullable().optional(),
	comment: z.string().max(COMMENT_MAX_LENGTH).nullable().optional(),
});

export type ReviewFields = z.infer<typeof ReviewFieldsSchema>;

// クライアントからの空文字("")はコメントなし(null)として扱う。
// trimしてから空判定することで、空白文字だけの入力もnull化する
export function normalizeReviewFields(input: ReviewFields): { rating: number | null; comment: string | null } {
	const trimmedComment = input.comment?.trim();
	return {
		rating: input.rating ?? null,
		comment: trimmedComment ? trimmedComment : null,
	};
}

// multipart/form-data(手動追加)から送られてくる文字列値をパースする。
// ratingは"1"〜"5"の文字列またはFormDataキー自体が無い(File | null)ケースがある
export function parseReviewFieldsFromFormData(formData: FormData): ReviewFields {
	const ratingRaw = formData.get("rating");
	const commentRaw = formData.get("comment");
	const rating = typeof ratingRaw === "string" && ratingRaw !== "" ? Number(ratingRaw) : null;
	return {
		rating: Number.isInteger(rating) ? rating : null,
		comment: typeof commentRaw === "string" ? commentRaw : null,
	};
}
