"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SearchResultThumbnail } from "@/components/SearchResultThumbnail";
import { ReviewStep, type ReviewValues } from "@/components/search/ReviewStep";

interface BookCandidate {
	ndlBibId: string;
	title: string;
	creator: string | null;
	publisher: string | null;
	isbn: string | null;
	extentRaw: string | null;
}

interface BookCandidateWithCover extends BookCandidate {
	// この検索バッチ(最大10件)内での上位5件だけtrue。Google Books APIの
	// 無料枠が1日1,000件と少ないため、書影取得はここでも上位のみに絞る
	// (/api/search/books/cover側の意図はコード内コメント参照)
	coverEligible: boolean;
}

interface SearchResponse {
	candidates: BookCandidate[];
	nextStartRecord: number | null;
	field: "title" | "creator";
}

const IMAGE_LOOKUP_LIMIT = 5;

/**
 * 書影を後から個別取得して差し込むサムネイル。検索結果一覧自体は
 * Google Booksの応答を待たずに表示され、マウント後にこのコンポーネントが
 * それぞれ非同期で画像を取りに行く(体感速度改善、ユーザー指摘への対応)。
 */
function BookCoverThumbnail({ candidate }: { candidate: BookCandidateWithCover }) {
	const [imageUrl, setImageUrl] = useState<string | null>(null);

	useEffect(() => {
		if (!candidate.coverEligible) return;
		let cancelled = false;
		const url = new URL("/api/search/books/cover", window.location.origin);
		url.searchParams.set("ndlBibId", candidate.ndlBibId);
		if (candidate.isbn) {
			url.searchParams.set("isbn", candidate.isbn);
		}
		fetch(url.toString())
			.then((res) => (res.ok ? (res.json() as Promise<{ imageUrl: string | null }>) : null))
			.then((data) => {
				if (!cancelled && data) setImageUrl(data.imageUrl);
			})
			.catch(() => {
				// 書影が取れなくてもプレースホルダー表示のままでよい(検索結果自体には影響させない)
			});
		return () => {
			cancelled = true;
		};
		// candidate.ndlBibIdが変わらない限り同じ本なので再取得しない
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [candidate.ndlBibId]);

	return <SearchResultThumbnail src={imageUrl} alt={candidate.title} />;
}

export default function BookSearchPage() {
	const router = useRouter();
	const [query, setQuery] = useState("");
	// 実際に検索を実行した時点のクエリ。「もっと探す」はこちらを使う(入力欄の
	// queryをそのまま使うと、検索後に文字を書き換えてから「もっと探す」を押した際、
	// 新しい文字列を古い検索結果に追記してしまうバグになる)
	const [searchedQuery, setSearchedQuery] = useState("");
	const [candidates, setCandidates] = useState<BookCandidateWithCover[]>([]);
	const [nextStartRecord, setNextStartRecord] = useState<number | null>(null);
	// 「もっと探す」でstartRecordを渡し直す際、初回検索で実際に使われた
	// フィールド(title→creatorへのフォールバックが起きたかどうか)を
	// 一緒に渡す。渡さないと2回目の呼び出しが別クエリの続きを取得してしまう
	const [searchField, setSearchField] = useState<"title" | "creator">("title");
	const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
	const [addingId, setAddingId] = useState<string | null>(null);
	const [addError, setAddError] = useState<{ ndlBibId: string; message: string } | null>(null);
	// 「コレクションに追加」をタップした候補のndlBibId。他画面のpendingIdと同じ考え方
	const [pendingId, setPendingId] = useState<string | null>(null);

	async function runSearch(startRecord: number, append: boolean, targetQuery: string, field?: "title" | "creator") {
		if (!targetQuery.trim()) return;
		setStatus("loading");
		const url = new URL("/api/search/books", window.location.origin);
		url.searchParams.set("q", targetQuery);
		url.searchParams.set("startRecord", String(startRecord));
		if (field) {
			url.searchParams.set("field", field);
		}

		const res = await fetch(url.toString());
		if (!res.ok) {
			setStatus("error");
			// 新規検索(もっと探すではない)の失敗時は前回の結果を残さない。残すと、
			// 表示中の(古いクエリの)結果に対して「もっと探す」を押した際、
			// 古いnextStartRecordで新しいクエリの結果が追記されてしまう
			if (!append) {
				setCandidates([]);
				setNextStartRecord(null);
			}
			return;
		}
		const data = (await res.json()) as SearchResponse;
		const withEligibility = data.candidates.map((c, i) => ({ ...c, coverEligible: i < IMAGE_LOOKUP_LIMIT }));
		setCandidates((prev) => (append ? [...prev, ...withEligibility] : withEligibility));
		setNextStartRecord(data.nextStartRecord);
		setSearchField(data.field);
		setStatus("idle");
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		// 空クエリで送信すると、runSearch内のtrimチェックで即returnする一方
		// searchedQueryだけ空文字に更新されてしまい、既存の検索結果が表示された
		// ままの状態で「もっと探す」がサイレントに無反応になる
		if (!query.trim()) return;
		setSearchedQuery(query);
		await runSearch(1, false, query);
	}

	async function handleAdd(candidate: BookCandidateWithCover, review: ReviewValues) {
		setAddingId(candidate.ndlBibId);
		setAddError(null);
		// coverEligibleはこの画面だけで使うクライアント側の状態なので、
		// サーバーへ送るボディには含めない
		const { coverEligible: _coverEligible, ...requestBody } = candidate;
		const res = await fetch("/api/shelf/books", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...requestBody, rating: review.rating, comment: review.comment }),
		});
		setAddingId(null);
		if (res.ok) {
			router.push("/");
			return;
		}
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		setAddError({
			ndlBibId: candidate.ndlBibId,
			message: body?.message ?? "追加に失敗しました。もう一度お試しください。",
		});
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
					placeholder="名前を入力してください"
				/>
				<button type="submit" className="btn btn-primary" disabled={status === "loading"}>
					検索
				</button>
			</form>

			<div style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
				<Link href={`/entries/new?subtype=book&title=${encodeURIComponent(query)}`} className="btn btn-ghost">
					手動で追加
				</Link>
			</div>

			{status === "error" && <p style={{ color: "var(--color-accent-800)" }}>検索に失敗しました。</p>}

			<div style={{ display: "grid", gap: "var(--space-3)" }}>
				{candidates.map((c) => (
					<div key={c.ndlBibId} className="card" style={{ flexDirection: "row" }}>
						<BookCoverThumbnail candidate={c} />
						<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0, flex: 1 }}>
							<p className="card-title">{c.title}</p>
							<p className="card-meta">
								{c.creator ?? "著者不明"} {c.publisher ? `／ ${c.publisher}` : ""}
							</p>
							{pendingId === c.ndlBibId ? (
								<ReviewStep
									submitting={addingId === c.ndlBibId}
									onSubmit={(review) => handleAdd(c, review)}
									onCancel={() => setPendingId(null)}
								/>
							) : (
								<button type="button" className="btn btn-secondary" onClick={() => setPendingId(c.ndlBibId)}>
									コレクションに追加
								</button>
							)}
							{addError?.ndlBibId === c.ndlBibId && (
								<p style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>{addError.message}</p>
							)}
						</div>
					</div>
				))}
			</div>

			{candidates.length > 0 && nextStartRecord !== null && (
				<button
					type="button"
					className="btn btn-ghost btn-block"
					style={{ marginTop: "var(--space-4)" }}
					onClick={() => runSearch(nextStartRecord, true, searchedQuery, searchField)}
					disabled={status === "loading"}
				>
					{status === "loading" ? "読み込み中…" : "もっと探す"}
				</button>
			)}
		</main>
	);
}
