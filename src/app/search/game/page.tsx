"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SearchResultThumbnail } from "@/components/SearchResultThumbnail";
import { ReviewStep, type ReviewValues } from "@/components/search/ReviewStep";
import { buildImageUrl } from "@/lib/sources/igdb";

interface GameCandidate {
	igdbId: number;
	title: string;
	titleJa: string | null;
	coverImageId: string | null;
	releaseDate: string | null;
	platforms: string[];
}

interface SearchResponse {
	candidates: GameCandidate[];
}

export default function GameSearchPage() {
	const router = useRouter();
	const [query, setQuery] = useState("");
	const [candidates, setCandidates] = useState<GameCandidate[]>([]);
	const [status, setStatus] = useState<"idle" | "loading">("idle");
	const [searchError, setSearchError] = useState<string | null>(null);
	const [addingId, setAddingId] = useState<number | null>(null);
	const [addError, setAddError] = useState<{ igdbId: number; message: string } | null>(null);
	// 「コレクションに追加」をタップした候補のigdbId。他画面のpendingIdと同じ考え方
	const [pendingId, setPendingId] = useState<number | null>(null);
	// 通信断・古いレスポンスの反映を避けるためのリクエスト連番(anime-mangaと同じ考え方)
	const searchSeqRef = useRef(0);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!query.trim()) return;
		setStatus("loading");
		setSearchError(null);
		const url = new URL("/api/search/games", window.location.origin);
		url.searchParams.set("q", query);

		const seq = ++searchSeqRef.current;

		try {
			const res = await fetch(url.toString());
			if (seq !== searchSeqRef.current) return;
			if (!res.ok) {
				// レート制限(429)・設定不足(502)など、原因ごとに違うメッセージを
				// サーバーが返すため、そのまま表示する
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				setSearchError(body?.message ?? "検索に失敗しました。もう一度お試しください。");
				setCandidates([]);
				return;
			}
			const data = (await res.json()) as SearchResponse;
			setCandidates(data.candidates);
		} catch {
			if (seq === searchSeqRef.current) {
				setSearchError("通信に失敗しました。接続を確認してもう一度お試しください。");
			}
		} finally {
			if (seq === searchSeqRef.current) {
				setStatus("idle");
			}
		}
	}

	async function handleAdd(candidate: GameCandidate, review: ReviewValues) {
		setAddingId(candidate.igdbId);
		setAddError(null);
		try {
			const res = await fetch("/api/shelf/games", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ igdbId: candidate.igdbId, rating: review.rating, comment: review.comment }),
			});
			if (res.ok) {
				router.push("/");
				return;
			}
			const body = (await res.json().catch(() => null)) as { message?: string } | null;
			setAddError({ igdbId: candidate.igdbId, message: body?.message ?? "追加に失敗しました。もう一度お試しください。" });
		} catch {
			setAddError({ igdbId: candidate.igdbId, message: "通信に失敗しました。接続を確認してもう一度お試しください。" });
		} finally {
			setAddingId(null);
		}
	}

	function subtitle(c: GameCandidate): string {
		const parts: string[] = [];
		// 日本語タイトルを主に出しているので、元のタイトルを補助表示する
		// (アニメ・マンガと同じ考え方。同名作品の判別に効く)
		if (c.titleJa && c.titleJa !== c.title) parts.push(c.title);
		if (c.releaseDate) parts.push(c.releaseDate);
		if (c.platforms.length > 0) parts.push(c.platforms.join(" / "));
		return parts.join(" ・ ");
	}

	return (
		<main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>ゲームを探す</h1>

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
				<Link href={`/entries/new?subtype=game&title=${encodeURIComponent(query)}`} className="btn btn-ghost">
					手動で追加
				</Link>
			</div>

			{searchError && <p style={{ color: "var(--color-accent-800)" }}>{searchError}</p>}

			<div style={{ display: "grid", gap: "var(--space-3)" }}>
				{candidates.map((c) => (
					<div key={c.igdbId} className="card" style={{ flexDirection: "row" }}>
						<SearchResultThumbnail
							src={c.coverImageId ? buildImageUrl(c.coverImageId) : null}
							alt={c.titleJa?.trim() || c.title}
						/>
						<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0, flex: 1 }}>
							<p className="card-title">{c.titleJa?.trim() || c.title}</p>
							<p className="card-meta">{subtitle(c) || "情報なし"}</p>
							{pendingId === c.igdbId ? (
								<ReviewStep
									submitting={addingId === c.igdbId}
									onSubmit={(review) => handleAdd(c, review)}
									onCancel={() => setPendingId(null)}
								/>
							) : (
								<button type="button" className="btn btn-secondary" onClick={() => setPendingId(c.igdbId)}>
									コレクションに追加
								</button>
							)}
							{addError?.igdbId === c.igdbId && (
								<p style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>{addError.message}</p>
							)}
						</div>
					</div>
				))}
			</div>
		</main>
	);
}
