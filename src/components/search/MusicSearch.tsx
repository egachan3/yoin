"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SearchResultThumbnail } from "@/components/SearchResultThumbnail";
import { SUBTYPE_LABELS } from "@/lib/categories";

// 「アルバム」「曲」はそれぞれ独立したカテゴリ(=独立したルート)になったため、
// 画面内の切替トグルは廃止し、どちらを探すかは呼び出し側から固定で受け取る
// (引き継ぎ.md 3.5節)。棚のカテゴリと検索画面が1対1で対応する
type MusicSubtype = "album" | "song";

// 検索APIが受け取るentityTypeの語彙と、棚のsubtypeの語彙は同一に揃えてある
// (iTunes側の"album"/"song"をそのままsubtypeに採用したため)。変換は要らない

const PLACEHOLDER: Record<MusicSubtype, string> = {
	// MusicBrainzは人気順のデータを持たず同名異曲に埋もれやすいため、
	// アーティスト名も一緒に入れるよう誘導する(PR #15の決定)
	album: "アルバム名 アーティスト名",
	song: "曲名 アーティスト名",
};

interface MusicCandidate {
	source: "musicbrainz" | "itunes";
	sourceId: string;
	title: string;
	artist: string | null;
	lengthMs: number | null;
	imageUrl: string | null;
}

interface SearchResponse {
	candidates: MusicCandidate[];
	nextOffset: number | null;
	source: "musicbrainz" | "itunes";
}

export function MusicSearch({ subtype }: { subtype: MusicSubtype }) {
	const router = useRouter();
	const [query, setQuery] = useState("");
	// 実際に検索を実行した時点のクエリ。「もっと探す」はこちらを使う(入力欄の
	// queryをそのまま使うと、検索後に文字を書き換えてから「もっと探す」を押した際、
	// 新しい文字列を古い検索結果に追記してしまうバグになる)
	const [searchedQuery, setSearchedQuery] = useState("");
	const [candidates, setCandidates] = useState<MusicCandidate[]>([]);
	const [nextOffset, setNextOffset] = useState<number | null>(null);
	const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
	const [addingId, setAddingId] = useState<string | null>(null);
	const [addError, setAddError] = useState<{ sourceId: string; message: string } | null>(null);

	async function runSearch(offset: number, append: boolean, targetQuery: string) {
		if (!targetQuery.trim()) return;
		setStatus("loading");
		const url = new URL("/api/search/music", window.location.origin);
		url.searchParams.set("q", targetQuery);
		url.searchParams.set("entityType", subtype);
		url.searchParams.set("offset", String(offset));

		const res = await fetch(url.toString());
		if (!res.ok) {
			setStatus("error");
			// 新規検索(もっと探すではない)の失敗時は前回の結果を残さない。残すと、
			// 表示中の(古いクエリの)結果に対して「もっと探す」を押した際、
			// 新しいクエリのnextOffsetを使わないまま古いnextOffsetでリクエストが
			// 飛び、無関係な結果が追記されてしまう(レビュー指摘で発見)
			if (!append) {
				setCandidates([]);
				setNextOffset(null);
			}
			return;
		}
		const data = (await res.json()) as SearchResponse;
		setCandidates((prev) => (append ? [...prev, ...data.candidates] : data.candidates));
		setNextOffset(data.nextOffset);
		setStatus("idle");
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		// 空クエリで送信すると、runSearch内のtrimチェックで即returnする一方
		// searchedQueryだけ空文字に更新されてしまい、既存の検索結果が表示された
		// ままの状態で「もっと探す」がサイレントに無反応になる(レビュー指摘で発見)
		if (!query.trim()) return;
		setSearchedQuery(query);
		await runSearch(0, false, query);
	}

	async function handleAdd(candidate: MusicCandidate) {
		setAddingId(candidate.sourceId);
		setAddError(null);
		const res = await fetch("/api/shelf/music", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				source: candidate.source,
				sourceId: candidate.sourceId,
				entityType: subtype,
			}),
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
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>{SUBTYPE_LABELS[subtype]}を探す</h1>

			<form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: "var(--space-6)" }}>
				<input
					type="text"
					className="input"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={PLACEHOLDER[subtype]}
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
					<div key={c.sourceId} className="card" style={{ flexDirection: "row" }}>
						<SearchResultThumbnail src={c.imageUrl} alt={c.title} aspectRatio="1 / 1" />
						<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0, flex: 1 }}>
							<p className="card-title">{c.title}</p>
							<p className="card-meta">{c.artist ?? "アーティスト不明"}</p>
							<button
								type="button"
								className="btn btn-secondary"
								onClick={() => handleAdd(c)}
								disabled={addingId === c.sourceId}
							>
								{addingId === c.sourceId ? "追加中…" : "コレクションに追加"}
							</button>
							{addError?.sourceId === c.sourceId && (
								<p style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>{addError.message}</p>
							)}
						</div>
					</div>
				))}
			</div>

			{candidates.length > 0 && nextOffset !== null && (
				<button
					type="button"
					className="btn btn-ghost btn-block"
					style={{ marginTop: "var(--space-4)" }}
					onClick={() => runSearch(nextOffset, true, searchedQuery)}
					disabled={status === "loading"}
				>
					{status === "loading" ? "読み込み中…" : "もっと探す"}
				</button>
			)}
		</main>
	);
}
