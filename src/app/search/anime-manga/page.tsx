"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
	// 実際に検索を実行した時点のクエリ。「もっと探す」はこちらを使う(入力欄の
	// queryをそのまま使うと、検索後に文字を書き換えてから「もっと探す」を押した際、
	// 新しい文字列を古い検索結果に追記してしまうバグになる)
	const [searchedQuery, setSearchedQuery] = useState("");
	const [candidates, setCandidates] = useState<MalCandidate[]>([]);
	const [nextOffset, setNextOffset] = useState<number | null>(null);
	const [status, setStatus] = useState<"idle" | "loading">("idle");
	const [searchError, setSearchError] = useState<string | null>(null);
	const [addingKey, setAddingKey] = useState<string | null>(null);
	// 実行中の検索を識別する連番と、現在アクティブな種別。
	// stateはクロージャに呼び出し時点の値で固定されるため、await後の判定には使えない。
	// refなら常に最新値を読めるので、古いレスポンスを確実に破棄できる
	const searchSeqRef = useRef(0);
	const activeTypeRef = useRef<MediaType>("anime");
	const [addError, setAddError] = useState<{ key: string; message: string } | null>(null);

	// MALのアニメIDとマンガIDは別採番で、同じ数値IDが両方に実在する。
	// malIdだけをkeyにすると、種別をまたいだ結果が並んだ際にkeyが衝突し、
	// 押していないカードが「追加中…」になる等の取り違えが起きる
	function candidateKey(c: MalCandidate): string {
		return `${c.mediaType}:${c.malId}`;
	}

	async function runSearch(offset: number, append: boolean, targetType: MediaType, targetQuery: string) {
		if (!targetQuery.trim()) return;
		setStatus("loading");
		setSearchError(null);
		const url = new URL("/api/search/anime-manga", window.location.origin);
		url.searchParams.set("q", targetQuery);
		url.searchParams.set("type", targetType);
		url.searchParams.set("offset", String(offset));

		const seq = ++searchSeqRef.current;

		try {
			const res = await fetch(url.toString());
			// 種別を切り替えた後・別のクエリで再検索した後に到着した古いレスポンスは
			// 一切反映しない。反映するとアニメとマンガが1つのリストに混ざり、
			// 「もっと探す」で両種別が追記され続ける
			if (seq !== searchSeqRef.current || activeTypeRef.current !== targetType) return;
			if (!res.ok) {
				// レート制限(429)・設定不足(502)など、原因ごとに違うメッセージを
				// サーバーが返すため、そのまま表示する。「検索に失敗しました」で
				// 潰すと、待てば直るのか設定が要るのかがユーザーに伝わらない
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				setSearchError(body?.message ?? "検索に失敗しました。もう一度お試しください。");
				// 新規検索の失敗時は前回の結果を残さない。残すとエラー表示の下に
				// 別クエリの結果が並び、「もっと探す」を押すと異なるクエリの
				// 結果が追記されて混ざる
				if (!append) {
					setCandidates([]);
					setNextOffset(null);
				}
				return;
			}
			const data = (await res.json()) as SearchResponse;
			setCandidates((prev) => (append ? [...prev, ...data.candidates] : data.candidates));
			setNextOffset(data.nextOffset);
		} catch {
			// 通信断・不正なJSON。finallyがないとstatusがloadingのまま固定され、
			// 検索ボタンがリロードするまで押せなくなる
			if (seq === searchSeqRef.current) {
				setSearchError("通信に失敗しました。接続を確認してもう一度お試しください。");
				// !res.okの分岐と同じ理由で、新規検索(もっと探すではない)の失敗時は
				// 前回の結果を残さない(レビュー指摘: catch経路だけクリア処理が
				// 漏れていた。通信断による2回目検索の失敗でも同じ混在バグが起きうる)
				if (!append) {
					setCandidates([]);
					setNextOffset(null);
				}
			}
		} finally {
			// 古いリクエストの完了で、後から始まった検索のローディング表示を
			// 消してしまわないようにする
			if (seq === searchSeqRef.current) {
				setStatus("idle");
			}
		}
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		// 空クエリで送信すると、runSearch内のtrimチェックで即returnする一方
		// searchedQueryだけ空文字に更新されてしまい、既存の検索結果が表示された
		// ままの状態で「もっと探す」がサイレントに無反応になる
		if (!query.trim()) return;
		setSearchedQuery(query);
		await runSearch(0, false, mediaType, query);
	}

	function handleMediaTypeChange(next: MediaType) {
		activeTypeRef.current = next;
		setMediaType(next);
		// 種別を切り替えたら前の結果は破棄する。残したまま追加すると、
		// 表示中の候補と送信するmediaTypeが食い違う
		setCandidates([]);
		setNextOffset(null);
		setSearchError(null);
		setAddError(null);
	}

	async function handleAdd(candidate: MalCandidate) {
		const key = candidateKey(candidate);
		setAddingKey(key);
		setAddError(null);
		try {
			const res = await fetch("/api/shelf/anime-manga", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				// 候補自身が持つmediaTypeを送る(画面のトグル状態ではなく)。
				// 検索結果と操作の間でトグルが変わっても食い違わないようにするため
				body: JSON.stringify({ mediaType: candidate.mediaType, malId: candidate.malId }),
			});
			if (res.ok) {
				router.push("/");
				return;
			}
			const body = (await res.json().catch(() => null)) as { message?: string } | null;
			setAddError({ key, message: body?.message ?? "追加に失敗しました。もう一度お試しください。" });
		} catch {
			// 通信断。ここでも「追加中…」のまま固定されるのを防ぐ
			setAddError({ key, message: "通信に失敗しました。接続を確認してもう一度お試しください。" });
		} finally {
			setAddingKey(null);
		}
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

			<div style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
				<Link href={`/entries/new?genre=anime_manga&title=${encodeURIComponent(query)}`} className="btn btn-ghost">
					手動で追加
				</Link>
			</div>

			{searchError && <p style={{ color: "var(--color-accent-800)" }}>{searchError}</p>}

			<div style={{ display: "grid", gap: "var(--space-3)" }}>
				{candidates.map((c) => {
					const key = candidateKey(c);
					return (
						<div key={key} className="card">
							<p className="card-title">{c.titleJa?.trim() || c.title}</p>
							<p className="card-meta">{subtitle(c) || "情報なし"}</p>
							<button
								type="button"
								className="btn btn-secondary"
								onClick={() => handleAdd(c)}
								disabled={addingKey === key}
							>
								{addingKey === key ? "追加中…" : "棚に追加"}
							</button>
							{addError?.key === key && (
								<p style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>{addError.message}</p>
							)}
						</div>
					);
				})}
			</div>

			{candidates.length > 0 && nextOffset !== null && (
				<button
					type="button"
					className="btn btn-ghost btn-block"
					style={{ marginTop: "var(--space-4)" }}
					onClick={() => runSearch(nextOffset, true, mediaType, searchedQuery)}
					disabled={status === "loading"}
				>
					{status === "loading" ? "読み込み中…" : "もっと探す"}
				</button>
			)}
		</main>
	);
}
