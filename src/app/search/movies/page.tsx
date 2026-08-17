"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TmdbAttribution } from "@/components/TmdbAttribution";

interface MovieCandidate {
	mediaType: "movie" | "tv";
	tmdbId: number;
	title: string;
	posterPath: string | null;
	releaseDate: string | null;
}

interface SearchResponse {
	candidates: MovieCandidate[];
}

const MEDIA_TYPE_LABEL: Record<"movie" | "tv", string> = {
	movie: "映画",
	tv: "ドラマ",
};

export default function MovieSearchPage() {
	const router = useRouter();
	const [query, setQuery] = useState("");
	const [candidates, setCandidates] = useState<MovieCandidate[]>([]);
	const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
	const [addingId, setAddingId] = useState<string | null>(null);
	const [addError, setAddError] = useState<{ key: string; message: string } | null>(null);

	function candidateKey(c: MovieCandidate): string {
		return `${c.mediaType}:${c.tmdbId}`;
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!query.trim()) return;
		setStatus("loading");
		const url = new URL("/api/search/movies", window.location.origin);
		url.searchParams.set("q", query);

		const res = await fetch(url.toString());
		if (!res.ok) {
			setStatus("error");
			return;
		}
		const data = (await res.json()) as SearchResponse;
		setCandidates(data.candidates);
		setStatus("idle");
	}

	async function handleAdd(candidate: MovieCandidate) {
		const key = candidateKey(candidate);
		setAddingId(key);
		setAddError(null);
		const res = await fetch("/api/shelf/movies", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mediaType: candidate.mediaType, tmdbId: candidate.tmdbId }),
		});
		setAddingId(null);
		if (res.ok) {
			router.push("/");
			return;
		}
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		setAddError({ key, message: body?.message ?? "追加に失敗しました。もう一度お試しください。" });
	}

	return (
		<main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>映画・ドラマを探す</h1>

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

			<div style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
				<Link href={`/entries/new?genre=movie_tv&title=${encodeURIComponent(query)}`} className="btn btn-ghost">
					手動で追加
				</Link>
			</div>

			{status === "error" && <p style={{ color: "var(--color-accent-800)" }}>検索に失敗しました。</p>}

			<div style={{ display: "grid", gap: "var(--space-3)" }}>
				{candidates.map((c) => {
					const key = candidateKey(c);
					return (
						<div key={key} className="card">
							<p className="card-title">
								{c.title} <span className="card-meta">{MEDIA_TYPE_LABEL[c.mediaType]}</span>
							</p>
							<p className="card-meta">{c.releaseDate ?? "公開日不明"}</p>
							<button
								type="button"
								className="btn btn-secondary"
								onClick={() => handleAdd(c)}
								disabled={addingId === key}
							>
								{addingId === key ? "追加中…" : "棚に追加"}
							</button>
							{addError?.key === key && (
								<p style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>{addError.message}</p>
							)}
						</div>
					);
				})}
			</div>

			<TmdbAttribution />
		</main>
	);
}
