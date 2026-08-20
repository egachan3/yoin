"use client";

import { useState } from "react";
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
			<div style={{ display: "flex", gap: 2 }} role="radiogroup" aria-label="評価">
				{[1, 2, 3, 4, 5].map((n) => {
					const filled = rating !== null && rating >= n;
					return (
						<button
							key={n}
							type="button"
							role="radio"
							aria-checked={rating === n}
							aria-label={`${n}点`}
							// 同じ星をもう一度押すと評価を取り消せる(評価は任意項目のため)
							onClick={() => setRating(rating === n ? null : n)}
							disabled={submitting}
							style={{
								background: "transparent",
								border: "none",
								cursor: "pointer",
								padding: 2,
								fontSize: 24,
								lineHeight: 1,
								color: filled ? "var(--color-accent)" : "var(--color-divider)",
							}}
						>
							{filled ? "★" : "☆"}
						</button>
					);
				})}
			</div>
			<div>
				<textarea
					className="input"
					value={comment}
					maxLength={COMMENT_MAX_LENGTH}
					onChange={(e) => setComment(e.target.value)}
					placeholder="感想(任意)"
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
