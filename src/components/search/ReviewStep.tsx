"use client";

import { useState } from "react";
import { StarRating } from "@/components/StarRating";
import { COMMENT_MAX_LENGTH } from "@/lib/review";

export interface ReviewValues {
	rating: number | null;
	comment: string | null;
	isPublic: boolean;
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
	const [isPublic, setIsPublic] = useState(true);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
			<fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={submitting}>
				<legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>この作品の公開設定</legend>
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
					{([true, false] as const).map((value) => (
						<label key={String(value)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", border: "1px solid", borderColor: isPublic === value ? "var(--color-text)" : "var(--color-divider)", borderRadius: "var(--radius-md)", background: isPublic === value ? "var(--color-neutral-200)" : "transparent", cursor: "pointer", fontSize: 13 }}>
							<input type="radio" name="entry-visibility" checked={isPublic === value} onChange={() => setIsPublic(value)} />
							{value ? "公開" : "非公開"}
						</label>
					))}
				</div>
				<p className="card-meta" style={{ margin: "6px 0 0" }}>非公開にした作品は公開コレクションに表示されません。</p>
			</fieldset>
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
					onClick={() => onSubmit({ rating, comment: comment.trim() || null, isPublic })}
					disabled={submitting}
				>
					{submitting ? "追加中…" : "追加する"}
				</button>
			</div>
		</div>
	);
}
