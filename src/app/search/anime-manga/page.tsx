"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type MediaType = "anime" | "manga";

interface MalCandidate {
	mediaType: MediaType;
	malId: number;
	title: string;
	titleJa: string | null;
	startDate: string | null;
	numEpisodes: number | null;
	numVolumes: number | null;
}

interface SearchResponse {
	candidates: MalCandidate[];
	nextOffset: number | null;
	mediaType: MediaType;
}

export default function AnimeMangaSearchPage() {
	const router = useRouter();
	const [mediaType, setMediaType] = useState<MediaType>("anime");
	const [query, setQuery] = useState("");
	const [candidates, setCandidates] = useState<MalCandidate[]>([]);
	const [nextOffset, setNextOffset] = useState<number | null>(null);
	const [status, setStatus] = useState<"idle" | "loading">("idle");
	const [searchError, setSearchError] = useState<string | null>(null);
	const [addingId, setAddingId] = useState<number | null>(null);
	const [addError, setAddError] = useState<{ malId: number; message: string } | null>(null);

	async function runSearch(offset: number, append: boolean, targetType: MediaType) {
		if (!query.trim()) return;
		setStatus("loading");
		setSearchError(null);
		const url = new URL("/api/search/anime-manga", window.location.origin);
		url.searchParams.set("q", query);
		url.searchParams.set("type", targetType);
		url.searchParams.set("offset", String(offset));

		const res = await fetch(url.toString());
		if (!res.ok) {
			// レート制限(429)・設定不足(502)など、原因ごとに違うメッセージを
			// サーバーが返すため、そのまま表示する。「検索に失敗しました」で
			// 潰すと、待てば直るのか設定が要るのかがユーザーに伝わらない
			const body = (await res.json().catch(() => null)) as { message?: string } | null;
			setSearchError(body?.message ?? "検索に失敗しました。もう一度お試しください。");
			setStatus("idle");
			return;
		}
		const data = (await res.json()) as SearchResponse;
		setCandidates((prev) => (append ? [...prev, ...data.candidates] : data.candidates));
		setNextOffset(data.nextOffset);
		setStatus("idle");
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		await runSearch(0, false, mediaType);
	}

	function handleMediaTypeChange(next: MediaType) {
		setMediaType(next);
		// 種別を切り替えたら前の結果は破棄する。残したまま追加すると、
		// 表示中の候補と送信するmediaTypeが食い違う
		setCandidates([]);
		setNextOffset(null);
		setSearchError(null);
	}

	async function handleAdd(candidate: MalCandidate) {
		setAddingId(candidate.malId);
		setAddError(null);
		const res = await fetch("/api/shelf/anime-manga", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			// 候補自身が持つmediaTypeを送る(画面のトグル状態ではなく)。
			// 検索結果と操作の間でトグルが変わっても食い違わないようにするため
			body: JSON.stringify({ mediaType: candidate.mediaType, malId: candidate.malId }),
		});
		setAddingId(null);
		if (res.ok) {
			router.push("/");
			return;
		}
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		setAddError({
			malId: candidate.malId,
			message: body?.message ?? "追加に失敗しました。もう一度お試しください。",
		});
	}

	function subtitle(c: MalCandidate): string {
		const parts: string[] = [];
		// 日本語タイトルを主に出しているので、元のタイトル(多くはローマ字)を補助表示する。
		// 同名作品の判別に効く
		if (c.titleJa && c.titleJa !== c.title) parts.push(c.title);
		if (c.startDate) parts.push(c.startDate);
		if (c.mediaType === "anime" && c.numEpisodes) parts.push(`全${c.numEpisodes}話`);
		if (c.mediaType === "manga" && c.numVolumes) parts.push(`全${c.numVolumes}巻`);
		return parts.join(" ・ ");
	}

	return (
		<main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>アニメ・マンガを探す</h1>

			<div style={{ display: "flex", gap: 8, marginBottom: "var(--space-4)" }}>
				<button
					type="button"
					className={mediaType === "anime" ? "btn btn-primary" : "btn btn-secondary"}
					onClick={() => handleMediaTypeChange("anime")}
				>
					アニメ
				</button>
				<button
					type="button"
					className={mediaType === "manga" ? "btn btn-primary" : "btn btn-secondary"}
					onClick={() => handleMediaTypeChange("manga")}
				>
					マンガ
				</button>
			</div>

			<form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: "var(--space-6)" }}>
				<input
					type="text"
					className="input"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={mediaType === "anime" ? "アニメのタイトルで検索" : "マンガのタイトルで検索"}
				/>
				<button type="submit" className="btn btn-primary" disabled={status === "loading"}>
					検索
				</button>
			</form>

			{searchError && <p style={{ color: "var(--color-accent-800)" }}>{searchError}</p>}

			<div style={{ display: "grid", gap: "var(--space-3)" }}>
				{candidates.map((c) => (
					<div key={c.malId} className="card">
						<p className="card-title">{c.titleJa?.trim() || c.title}</p>
						<p className="card-meta">{subtitle(c) || "情報なし"}</p>
						<button
							type="button"
							className="btn btn-secondary"
							onClick={() => handleAdd(c)}
							disabled={addingId === c.malId}
						>
							{addingId === c.malId ? "追加中…" : "棚に追加"}
						</button>
						{addError?.malId === c.malId && (
							<p style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>{addError.message}</p>
						)}
					</div>
				))}
			</div>

			{candidates.length > 0 && nextOffset !== null && (
				<button
					type="button"
					className="btn btn-ghost btn-block"
					style={{ marginTop: "var(--space-4)" }}
					onClick={() => runSearch(nextOffset, true, mediaType)}
					disabled={status === "loading"}
				>
					{status === "loading" ? "読み込み中…" : "もっと探す"}
				</button>
			)}
		</main>
	);
}
