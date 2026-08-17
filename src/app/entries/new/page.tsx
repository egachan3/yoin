"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GENRE_LABELS, MANUAL_PLACEHOLDER_IMAGE, STATUS_LABELS } from "@/lib/manual-entry";
import { compressImage } from "@/lib/image-compress";
import type { Genre, ShelfEntryStatus } from "@/db/schema";

const GENRES = Object.keys(GENRE_LABELS) as Genre[];
const STATUSES = Object.keys(STATUS_LABELS) as ShelfEntryStatus[];

function isGenre(value: string | null): value is Genre {
	return value !== null && (GENRES as string[]).includes(value);
}

function todayLocalDate(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

// 各検索画面の「見つからない場合はこちらから手動で追加」リンクから、
// ?genre=book&title=... の形で遷移してきた場合に初期値として使う。
// useSearchParams()はビルド時の静的最適化のためSuspense境界が必須(Next.js App Router)
function ManualEntryForm() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const genreParam = searchParams.get("genre");
	const [genre, setGenre] = useState<Genre>(isGenre(genreParam) ? genreParam : "book");
	const [title, setTitle] = useState(searchParams.get("title") ?? "");
	const [date, setDate] = useState(todayLocalDate());
	const [status, setStatus] = useState<ShelfEntryStatus>("completed");
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
		if (!title.trim()) {
			setError("タイトルを入力してください。");
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			const formData = new FormData();
			formData.set("genre", genre);
			formData.set("title", title);
			formData.set("date", date);
			formData.set("status", status);
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

	return (
		<main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-2)" }}>作品を手動で追加</h1>
			<p className="text-muted" style={{ fontSize: 13, marginBottom: "var(--space-6)" }}>
				検索でヒットしなかった作品を記録します。画像は任意で追加でき、この記録はあなた以外には表示されません。
			</p>

			<form onSubmit={handleSubmit} style={{ display: "grid", gap: "var(--space-4)" }}>
				<div className="field">
					<label>画像</label>
					<div
						style={{
							position: "relative",
							width: 160,
							// アルバムジャケットは正方形が通例のため、音楽ジャンルのみ1:1にする
							aspectRatio: genre === "music" ? "1 / 1" : "2 / 3",
							borderRadius: "var(--radius-md)",
							overflow: "hidden",
							background: "var(--color-accent-100)",
							marginInline: "auto",
						}}
					>
						{/* eslint-disable-next-line @next/next/no-img-element -- ローカルのBlob URL/静的アセットのため次のimage最適化は不要 */}
						<img
							src={imagePreviewUrl ?? MANUAL_PLACEHOLDER_IMAGE[genre]}
							alt=""
							style={{ width: "100%", height: "100%", objectFit: "cover" }}
						/>
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
					<label htmlFor="genre">ジャンル</label>
					<select
						id="genre"
						className="input"
						value={genre}
						onChange={(e) => setGenre(e.target.value as Genre)}
					>
						{GENRES.map((g) => (
							<option key={g} value={g}>
								{GENRE_LABELS[g]}
							</option>
						))}
					</select>
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
					<label htmlFor="status">状態</label>
					<select
						id="status"
						className="input"
						value={status}
						onChange={(e) => setStatus(e.target.value as ShelfEntryStatus)}
					>
						{STATUSES.map((s) => (
							<option key={s} value={s}>
								{STATUS_LABELS[s]}
							</option>
						))}
					</select>
				</div>

				{error && <p style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>{error}</p>}

				<button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
					{submitting ? "追加中…" : "棚に追加"}
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
