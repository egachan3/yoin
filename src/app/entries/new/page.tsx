"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { compressImage } from "@/lib/image-compress";
import { SUBTYPE_LABELS, SUBTYPE_ICON, aspectRatioFor, isSubtype } from "@/lib/categories";
import { COMMENT_MAX_LENGTH } from "@/lib/review";
import { StarRating } from "@/components/StarRating";

function todayLocalDate(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

// 各検索画面の「見つからない場合はこちらから手動で追加」リンクから、
// ?subtype=book&title=... の形で遷移してくる。手動追加に至る導線は必ず
// 特定のカテゴリの検索画面を経由するため、カテゴリはここで選び直させず
// 表示するだけにしている(引き継ぎ.md 3.5節)。
// useSearchParams()はビルド時の静的最適化のためSuspense境界が必須(Next.js App Router)
function ManualEntryForm() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const subtypeParam = searchParams.get("subtype");
	const subtype = isSubtype(subtypeParam) ? subtypeParam : null;
	const [title, setTitle] = useState(searchParams.get("title") ?? "");
	const [date, setDate] = useState(todayLocalDate());
	const [rating, setRating] = useState<number | null>(null);
	const [comment, setComment] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [imageBlob, setImageBlob] = useState<Blob | null>(null);
	const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
	const [imageError, setImageError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// createObjectURL()で作ったURLはページを離れる際に明示的に解放しないと
	// メモリリークするため、アンマウント時・差し替え時にrevokeする
	useEffect(() => {
		return () => {
			if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
		};
	}, [imagePreviewUrl]);

	async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		// 同じファイルを選び直しても onChange が発火するようにリセットする
		e.target.value = "";
		if (!file) return;
		setImageError(null);
		try {
			const compressed = await compressImage(file);
			setImageBlob(compressed);
			setImagePreviewUrl((prev) => {
				if (prev) URL.revokeObjectURL(prev);
				return URL.createObjectURL(compressed);
			});
		} catch {
			setImageError("画像の処理に失敗しました。別の画像でお試しください。");
		}
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		// subtypeがnullのときはフォーム自体を描画しないので、ここには到達しない
		if (!subtype) return;
		if (!title.trim()) {
			setError("タイトルを入力してください。");
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			const formData = new FormData();
			formData.set("subtype", subtype);
			formData.set("title", title);
			formData.set("date", date);
			if (rating !== null) {
				formData.set("rating", String(rating));
			}
			if (comment.trim()) {
				formData.set("comment", comment.trim());
			}
			if (imageBlob) {
				formData.set("image", imageBlob, "photo.jpg");
			}
			const res = await fetch("/api/shelf/manual", { method: "POST", body: formData });
			if (res.ok) {
				router.push("/");
				return;
			}
			const body = (await res.json().catch(() => null)) as { message?: string } | null;
			setError(body?.message ?? "追加に失敗しました。もう一度お試しください。");
		} catch {
			setError("通信に失敗しました。接続を確認してもう一度お試しください。");
		} finally {
			setSubmitting(false);
		}
	}

	// カテゴリが特定できない場合はフォームを出さない。既定値(例: 本)に倒すと、
	// マンガのつもりで追加したものが黙って本として保存されてしまう。
	// 通常は各検索画面のリンクから必ず?subtype=...付きで遷移してくる
	if (!subtype) {
		return (
			<main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
				<h1 style={{ fontSize: 24, marginBottom: "var(--space-2)" }}>カテゴリが指定されていません</h1>
				<p className="text-muted" style={{ fontSize: 13, marginBottom: "var(--space-6)" }}>
					手動で追加するには、追加したいカテゴリの検索画面から「手動で追加」を選んでください。
				</p>
				<Link href="/" className="btn btn-primary btn-block">
					コレクションに戻る
				</Link>
			</main>
		);
	}

	return (
		<main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-2)" }}>
				{SUBTYPE_LABELS[subtype]}を手動で追加
			</h1>
			<p className="text-muted" style={{ fontSize: 13, marginBottom: "var(--space-6)" }}>
				検索でヒットしなかった作品を記録します。画像は任意で追加できます。棚を公開している場合、この記録と画像は公開棚の閲覧者にも表示されます。
			</p>

			<form onSubmit={handleSubmit} style={{ display: "grid", gap: "var(--space-4)" }}>
				<div className="field">
					<label>画像</label>
					<div
						style={{
							position: "relative",
							width: 160,
							// アルバムジャケットは正方形が通例のため、音楽のみ1:1にする
							aspectRatio: aspectRatioFor(subtype),
							borderRadius: "var(--radius-image)",
							overflow: "hidden",
							background: "var(--color-accent-100)",
							marginInline: "auto",
							// プレースホルダー(⊕シートと同じsubtypeアイコン)はcoverで
							// 引き伸ばさず、中央に固定サイズで表示する(アイコンは透過PNGの
							// 小さいグリフのため、coverすると引き伸び・トリミングされて崩れる)
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						{imagePreviewUrl ? (
							// eslint-disable-next-line @next/next/no-img-element -- ローカルのBlob URLのため次のimage最適化は不要
							<img
								src={imagePreviewUrl}
								alt=""
								style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
							/>
						) : (
							// eslint-disable-next-line @next/next/no-img-element -- 静的アセットのため次のimage最適化は不要
							<img src={SUBTYPE_ICON[subtype]} alt="" style={{ width: 56, height: 56 }} />
						)}
						<button
							type="button"
							className="btn btn-icon"
							aria-label="画像を選択"
							onClick={() => fileInputRef.current?.click()}
							style={{
								position: "absolute",
								right: 8,
								bottom: 8,
								background: "var(--color-text)",
								color: "var(--color-bg)",
								border: "none",
							}}
						>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
								<path
									d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinejoin="round"
								/>
								<circle cx="12" cy="14" r="3.5" stroke="currentColor" strokeWidth="1.5" />
							</svg>
						</button>
					</div>
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						capture="environment"
						style={{ display: "none" }}
						onChange={handleImageSelect}
					/>
					{imageError && <p style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>{imageError}</p>}
				</div>

				<div className="field">
					<label htmlFor="title">タイトル</label>
					<input
						id="title"
						type="text"
						className="input"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						maxLength={200}
						placeholder="作品のタイトル"
					/>
				</div>

				<div className="field">
					<label htmlFor="date">日付</label>
					<input
						id="date"
						type="date"
						className="input"
						value={date}
						onChange={(e) => setDate(e.target.value)}
					/>
				</div>

				<div className="field">
					<label>評価</label>
					<StarRating value={rating} onChange={setRating} disabled={submitting} />
				</div>

				<div className="field">
					<label htmlFor="comment">感想</label>
					<textarea
						id="comment"
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

				{error && <p style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>{error}</p>}

				<button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
					{submitting ? "追加中…" : "コレクションに追加"}
				</button>
			</form>
		</main>
	);
}

export default function ManualEntryPage() {
	return (
		<Suspense fallback={null}>
			<ManualEntryForm />
		</Suspense>
	);
}
