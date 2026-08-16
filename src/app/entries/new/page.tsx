"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GENRE_LABELS, STATUS_LABELS } from "@/lib/manual-entry";
import type { Genre, ShelfEntryStatus } from "@/db/schema";

const GENRES = Object.keys(GENRE_LABELS) as Genre[];
const STATUSES = Object.keys(STATUS_LABELS) as ShelfEntryStatus[];

function todayLocalDate(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export default function ManualEntryPage() {
	const router = useRouter();
	const [genre, setGenre] = useState<Genre>("book");
	const [title, setTitle] = useState("");
	const [date, setDate] = useState(todayLocalDate());
	const [status, setStatus] = useState<ShelfEntryStatus>("completed");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!title.trim()) {
			setError("タイトルを入力してください。");
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			const res = await fetch("/api/shelf/manual", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ genre, title, date, status }),
			});
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
				検索でヒットしなかった作品を記録します。画像はジャンルごとの目印画像が自動で割り当てられ、この記録はあなた以外には表示されません。
			</p>

			<form onSubmit={handleSubmit} style={{ display: "grid", gap: "var(--space-4)" }}>
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
