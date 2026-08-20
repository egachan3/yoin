"use client";

import { useState } from "react";
import { StarRating } from "@/components/StarRating";
import { COMMENT_MAX_LENGTH } from "@/lib/review";

export interface ReviewValues {
	rating: number | null;
	comment: string | null;
}

/**
 * 検索結果カードの「コレクションに追加」タップ後に、ボタンの代わりに表示する
 * 星評価(5段階・任意)+感想(50文字以内・任意)の入力ステップ。
 * 各検索画面(VideoSearch/MusicSearch/AnimeMangaSearch/book/game)から
 * 同じ見た目・挙動で使えるよう共通コンポーネント化している。
 */
export function ReviewStep({
	submitting,
	onSubmit,
	onCancel,
}: {
	submitting: boolean;
	onSubmit: (review: ReviewValues) => void;
	onCancel: () => void;
}) {
	const [rating, setRating] = useState<number | null>(null);
	const [comment, setComment] = useState("");

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
			<StarRating value={rating} onChange={setRating} disabled={submitting} />
			<div>
				<textarea
					className="input"
					value={comment}
					maxLength={COMMENT_MAX_LENGTH}
					onChange={(e) => setComment(e.target.value)}
					placeholder="感想(任意)"
					aria-label="感想"
					rows={2}
					disabled={submitting}
					style={{ resize: "none" }}
				/>
				<p className="card-meta" style={{ textAlign: "right", marginTop: 2 }}>
					{comment.length}/{COMMENT_MAX_LENGTH}
				</p>
			</div>
			<div style={{ display: "flex", gap: 8 }}>
				<button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel} disabled={submitting}>
					キャンセル
				</button>
				<button
					type="button"
					className="btn btn-primary"
					style={{ flex: 1 }}
					onClick={() => onSubmit({ rating, comment: comment.trim() || null })}
					disabled={submitting}
				>
					{submitting ? "追加中…" : "追加する"}
				</button>
			</div>
		</div>
	);
}
