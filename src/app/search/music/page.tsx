"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Entity = "song" | "album";

interface MusicCandidate {
	source: "musicbrainz" | "itunes";
	sourceId: string;
	title: string;
	artist: string | null;
	lengthMs: number | null;
}

interface SearchResponse {
	candidates: MusicCandidate[];
	nextOffset: number | null;
	source: "musicbrainz" | "itunes";
}

export default function MusicSearchPage() {
	const router = useRouter();
	const [entity, setEntity] = useState<Entity>("song");
	const [query, setQuery] = useState("");
	const [candidates, setCandidates] = useState<MusicCandidate[]>([]);
	const [nextOffset, setNextOffset] = useState<number | null>(null);
	const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
	const [addingId, setAddingId] = useState<string | null>(null);
	const [addError, setAddError] = useState<{ sourceId: string; message: string } | null>(null);

	async function runSearch(offset: number, append: boolean, targetEntity: Entity) {
		if (!query.trim()) return;
		setStatus("loading");
		const url = new URL("/api/search/music", window.location.origin);
		url.searchParams.set("q", query);
		url.searchParams.set("entityType", targetEntity);
		url.searchParams.set("offset", String(offset));

		const res = await fetch(url.toString());
		if (!res.ok) {
			setStatus("error");
			return;
		}
		const data = (await res.json()) as SearchResponse;
		setCandidates((prev) => (append ? [...prev, ...data.candidates] : data.candidates));
		setNextOffset(data.nextOffset);
		setStatus("idle");
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		await runSearch(0, false, entity);
	}

	function handleEntityChange(next: Entity) {
		setEntity(next);
		setCandidates([]);
		setNextOffset(null);
	}

	async function handleAdd(candidate: MusicCandidate) {
		setAddingId(candidate.sourceId);
		setAddError(null);
		const res = await fetch("/api/shelf/music", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ source: candidate.source, sourceId: candidate.sourceId, entityType: entity }),
		});
		setAddingId(null);
		if (res.ok) {
			router.push("/");
			return;
		}
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		setAddError({
			sourceId: candidate.sourceId,
			message: body?.message ?? "追加に失敗しました。もう一度お試しください。",
		});
	}

	return (
		<main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>音楽を探す</h1>

			<div style={{ display: "flex", gap: 8, marginBottom: "var(--space-4)" }}>
				<button
					type="button"
					className={entity === "song" ? "btn btn-primary" : "btn btn-secondary"}
					onClick={() => handleEntityChange("song")}
				>
					曲
				</button>
				<button
					type="button"
					className={entity === "album" ? "btn btn-primary" : "btn btn-secondary"}
					onClick={() => handleEntityChange("album")}
				>
					アルバム
				</button>
			</div>

			<form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: "var(--space-6)" }}>
				<input
					type="text"
					className="input"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={entity === "song" ? "曲名で検索" : "アルバム名で検索"}
				/>
				<button type="submit" className="btn btn-primary" disabled={status === "loading"}>
					検索
				</button>
			</form>

			{status === "error" && <p style={{ color: "var(--color-accent-800)" }}>検索に失敗しました。</p>}

			<div style={{ display: "grid", gap: "var(--space-3)" }}>
				{candidates.map((c) => (
					<div key={c.sourceId} className="card">
						<p className="card-title">{c.title}</p>
						<p className="card-meta">{c.artist ?? "アーティスト不明"}</p>
						<button
							type="button"
							className="btn btn-secondary"
							onClick={() => handleAdd(c)}
							disabled={addingId === c.sourceId}
						>
							{addingId === c.sourceId ? "追加中…" : "棚に追加"}
						</button>
						{addError?.sourceId === c.sourceId && (
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
					onClick={() => runSearch(nextOffset, true, entity)}
					disabled={status === "loading"}
				>
					{status === "loading" ? "読み込み中…" : "もっと探す"}
				</button>
			)}
		</main>
	);
}
