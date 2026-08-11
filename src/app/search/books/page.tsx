"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface BookCandidate {
	ndlBibId: string;
	title: string;
	creator: string | null;
	publisher: string | null;
	isbn: string | null;
	extentRaw: string | null;
}

interface SearchResponse {
	candidates: BookCandidate[];
	nextStartRecord: number | null;
	field: "title" | "creator";
}

export default function BookSearchPage() {
	const router = useRouter();
	const [query, setQuery] = useState("");
	const [candidates, setCandidates] = useState<BookCandidate[]>([]);
	const [nextStartRecord, setNextStartRecord] = useState<number | null>(null);
	// 「もっと探す」でstartRecordを渡し直す際、初回検索で実際に使われた
	// フィールド(title→creatorへのフォールバックが起きたかどうか)を
	// 一緒に渡す。渡さないと2回目の呼び出しが別クエリの続きを取得してしまう
	const [searchField, setSearchField] = useState<"title" | "creator">("title");
	const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
	const [addingId, setAddingId] = useState<string | null>(null);

	async function runSearch(startRecord: number, append: boolean, field?: "title" | "creator") {
		if (!query.trim()) return;
		setStatus("loading");
		const url = new URL("/api/search/books", window.location.origin);
		url.searchParams.set("q", query);
		url.searchParams.set("startRecord", String(startRecord));
		if (field) {
			url.searchParams.set("field", field);
		}

		const res = await fetch(url.toString());
		if (!res.ok) {
			setStatus("error");
			return;
		}
		const data = (await res.json()) as SearchResponse;
		setCandidates((prev) => (append ? [...prev, ...data.candidates] : data.candidates));
		setNextStartRecord(data.nextStartRecord);
		setSearchField(data.field);
		setStatus("idle");
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		await runSearch(1, false);
	}

	async function handleAdd(candidate: BookCandidate) {
		setAddingId(candidate.ndlBibId);
		const res = await fetch("/api/shelf/books", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(candidate),
		});
		setAddingId(null);
		if (res.ok) {
			router.push("/");
		}
	}

	return (
		<main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>本を探す</h1>

			<form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: "var(--space-6)" }}>
				<input
					type="text"
					className="input"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="タイトルで検索"
				/>
				<button type="submit" className="btn btn-primary" disabled={status === "loading"}>
					検索
				</button>
			</form>

			{status === "error" && <p style={{ color: "var(--color-accent-800)" }}>検索に失敗しました。</p>}

			<div style={{ display: "grid", gap: "var(--space-3)" }}>
				{candidates.map((c) => (
					<div key={c.ndlBibId} className="card">
						<p className="card-title">{c.title}</p>
						<p className="card-meta">
							{c.creator ?? "著者不明"} {c.publisher ? `／ ${c.publisher}` : ""}
						</p>
						<button
							type="button"
							className="btn btn-secondary"
							onClick={() => handleAdd(c)}
							disabled={addingId === c.ndlBibId}
						>
							{addingId === c.ndlBibId ? "追加中…" : "棚に追加"}
						</button>
					</div>
				))}
			</div>

			{candidates.length > 0 && nextStartRecord !== null && (
				<button
					type="button"
					className="btn btn-ghost btn-block"
					style={{ marginTop: "var(--space-4)" }}
					onClick={() => runSearch(nextStartRecord, true, searchField)}
					disabled={status === "loading"}
				>
					{status === "loading" ? "読み込み中…" : "もっと探す"}
				</button>
			)}
		</main>
	);
}
