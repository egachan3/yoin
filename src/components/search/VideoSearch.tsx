"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SearchResultThumbnail } from "@/components/SearchResultThumbnail";
import { buildImageUrl } from "@/lib/sources/tmdb";
import { SUBTYPE_LABELS } from "@/lib/categories";

// 「映画」「ドラマ」がそれぞれ独立したカテゴリになったのに伴い、以前の
// 統合検索(TMDBの/search/movieと/search/tvを同時に叩いて結果を混ぜる)をやめ、
// 呼び出し側から片方を固定で受け取る形にした(引き継ぎ.md 3.5節)。
// TMDBへのリクエストも1回の検索につき半分になる
type VideoSubtype = "movie" | "tv";

interface MovieCandidate {
	mediaType: VideoSubtype;
	tmdbId: number;
	title: string;
	posterPath: string | null;
	releaseDate: string | null;
}

interface SearchResponse {
	candidates: MovieCandidate[];
}

export function VideoSearch({ subtype }: { subtype: VideoSubtype }) {
	const router = useRouter();
	const [query, setQuery] = useState("");
	const [candidates, setCandidates] = useState<MovieCandidate[]>([]);
	const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
	const [addingId, setAddingId] = useState<number | null>(null);
	const [addError, setAddError] = useState<{ tmdbId: number; message: string } | null>(null);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!query.trim()) return;
		setStatus("loading");
		const url = new URL("/api/search/movies", window.location.origin);
		url.searchParams.set("q", query);
		url.searchParams.set("mediaType", subtype);

		const res = await fetch(url.toString());
		if (!res.ok) {
			setStatus("error");
			// 検索失敗時に前回の結果を残すと、表示中の候補が今のクエリの結果だと
			// 誤解される(他ジャンルの検索画面と揃えた挙動、PR #15の修正と同趣旨)
			setCandidates([]);
			return;
		}
		const data = (await res.json()) as SearchResponse;
		setCandidates(data.candidates);
		setStatus("idle");
	}

	async function handleAdd(candidate: MovieCandidate) {
		setAddingId(candidate.tmdbId);
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
		setAddError({
			tmdbId: candidate.tmdbId,
			message: body?.message ?? "追加に失敗しました。もう一度お試しください。",
		});
	}

	return (
		<main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>{SUBTYPE_LABELS[subtype]}を探す</h1>

			<form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: "var(--space-6)" }}>
				<input
					type="text"
					className="input"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="名前を入力してください"
				/>
				<button type="submit" className="btn btn-primary" disabled={status === "loading"}>
					検索
				</button>
			</form>

			<div style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
				<Link href={`/entries/new?subtype=${subtype}&title=${encodeURIComponent(query)}`} className="btn btn-ghost">
					手動で追加
				</Link>
			</div>

			{status === "error" && <p style={{ color: "var(--color-accent-800)" }}>検索に失敗しました。</p>}

			<div style={{ display: "grid", gap: "var(--space-3)" }}>
				{candidates.map((c) => (
					<div key={c.tmdbId} className="card" style={{ flexDirection: "row" }}>
						<SearchResultThumbnail src={c.posterPath ? buildImageUrl(c.posterPath) : null} alt={c.title} />
						<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0, flex: 1 }}>
							<p className="card-title">{c.title}</p>
							<p className="card-meta">{c.releaseDate ?? "公開日不明"}</p>
							<button
								type="button"
								className="btn btn-secondary"
								onClick={() => handleAdd(c)}
								disabled={addingId === c.tmdbId}
							>
								{addingId === c.tmdbId ? "追加中…" : "コレクションに追加"}
							</button>
							{addError?.tmdbId === c.tmdbId && (
								<p style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>{addError.message}</p>
							)}
						</div>
					</div>
				))}
			</div>
		</main>
	);
}
