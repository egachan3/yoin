import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { listCategoryCounts, listShelfEntries } from "@/db/shelf";
import { SUBTYPE_LABELS, SUBTYPE_ORDER } from "@/lib/categories";
import { resolveEntryImageSrc, isPlaceholderIconSrc } from "@/lib/entry-image";
import Link from "next/link";

/**
 * プロフィール画面の仮置き。中身(ハンドル名・プロフィールカード・
 * 記録件数の統計、右上の歯車からログアウト/ハンドル編集)はPR3で実装する
 * (引き継ぎ.md 3.5節)。下部バーからの遷移先が404にならないよう、
 * 認証チェックだけ行った「準備中」表示を先に用意している。
 */
export default async function ProfilePage() {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session) {
		redirect("/login");
	}
	if (!session.user.handle_normalized) {
		redirect("/onboarding");
	}

	const db = createDb(env.DB);
	// 全体件数はカテゴリ別件数の合計で求める(同じJOIN条件のcountShelfEntriesを
	// 別途呼ぶとD1へのクエリが1本増えるだけの冗長な呼び出しになるため、
	// listCategoryCountsの結果から導出する形にした。レビュー指摘)
	const [categoryCounts, entries] = await Promise.all([
		listCategoryCounts(db, session.user.id),
		listShelfEntries(db, session.user.id),
	]);
	const countBySubtype = new Map(categoryCounts.map((row) => [row.subtype, Number(row.count)]));
	const total = categoryCounts.reduce((sum, row) => sum + Number(row.count), 0);

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-6) var(--space-4) 100px" }}>
			<header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", marginBottom: "var(--space-6)" }}>
				<h1 style={{ fontSize: 28, margin: 0 }}>プロフィール</h1>
				<Link href="/profile/settings" className="btn btn-secondary btn-icon" aria-label="設定">
					<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path fillRule="evenodd" d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.8 7.8 0 0 0-1.69-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42l-.38 2.65c-.61.25-1.18.59-1.69.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .6.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65A.5.5 0 0 0 10 22h4a.5.5 0 0 0 .5-.42l.38-2.65a7.8 7.8 0 0 0 1.69-.98l2.49 1a.5.5 0 0 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" clipRule="evenodd" />
					</svg>
				</Link>
			</header>

			<section className="card elev-sm" aria-label="プロフィール" style={{ padding: "var(--space-6)" }}>
				<div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
					<div aria-hidden="true" style={{ flex: "0 0 auto", display: "grid", placeItems: "center", width: 76, height: 76, borderRadius: "50%", background: "var(--color-accent-2-200)", color: "var(--color-accent-2-800)", fontFamily: "var(--font-heading)", fontSize: 30 }}>
						{session.user.handle?.slice(0, 1).toUpperCase()}
					</div>
					<div style={{ minWidth: 0 }}>
						<h2 style={{ fontSize: 24, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis" }}>@{session.user.handle}</h2>
						<p className="text-muted" style={{ margin: 0 }}>自分の好きなものを記録しています</p>
					</div>
				</div>
				<div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-5)" }}>
					<Link href={`/@${session.user.handle}`} className="btn btn-primary" style={{ flex: 1 }}>公開コレクションを見る</Link>
					<Link href={`/@${session.user.handle}`} className="btn btn-secondary" style={{ flex: 1 }}>コレクションをシェア</Link>
				</div>
			</section>

			<section id="overview" style={{ marginTop: "var(--space-8)" }} aria-labelledby="stats-heading">
				<div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
					<h2 id="stats-heading" style={{ fontSize: 20, margin: 0 }}>記録の内訳</h2>
					<span className="text-muted" style={{ fontSize: 13 }}>全 {total}件</span>
				</div>
				<div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "var(--space-2)" }}>
					{SUBTYPE_ORDER.filter((subtype) => (countBySubtype.get(subtype) ?? 0) > 0).map((subtype) => (
						<div className="card" key={subtype} style={{ minHeight: 82, padding: "var(--space-3)", gap: 4 }}>
							<span className="card-meta">{SUBTYPE_LABELS[subtype]}</span>
							<strong style={{ fontFamily: "var(--font-heading)", fontSize: 24, lineHeight: 1 }}>{countBySubtype.get(subtype)}</strong>
						</div>
					))}
				</div>
			</section>

			<section id="records" style={{ marginTop: "var(--space-8)" }} aria-labelledby="recent-heading">
				<div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
					<h2 id="recent-heading" style={{ fontSize: 20, margin: 0 }}>最近の記録</h2>
					<Link href="/" className="text-muted" style={{ fontSize: 13 }}>すべて見る</Link>
				</div>
				{entries.length === 0 ? <p className="text-muted">まだ記録がありません。</p> : (
					<div className="card" style={{ padding: 0, overflow: "hidden" }}>
						{entries.slice(0, 6).map((entry, index) => <RecentEntry key={entry.id} entry={entry} isLast={index === Math.min(entries.length, 6) - 1} />)}
					</div>
				)}
			</section>
		</main>
	);
}

function RecentEntry({ entry, isLast }: { entry: Awaited<ReturnType<typeof listShelfEntries>>[number]; isLast: boolean }) {
	const src = resolveEntryImageSrc(entry);
	const icon = isPlaceholderIconSrc(src);
	const date = new Date(entry.added_at * 1000).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo" });
	return <Link href={`/entries/${entry.id}`} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3)", borderBottom: isLast ? "none" : "1px solid var(--color-divider)", textDecoration: "none", color: "inherit" }}>
		<div style={{ width: 48, height: 58, flex: "0 0 auto", borderRadius: "var(--radius-image)", overflow: "hidden", background: "var(--color-neutral-200)", display: "grid", placeItems: "center" }}>
			{src && <img src={src} alt="" style={icon ? { width: "42%" } : { width: "100%", height: "100%", objectFit: "cover" }} />}
		</div>
		<div style={{ minWidth: 0, flex: 1 }}><p style={{ margin: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.title}</p><p className="card-meta" style={{ margin: 0 }}>{SUBTYPE_LABELS[entry.subtype]} · {date}</p></div>
		<span aria-hidden="true" className="text-muted" style={{ fontSize: 22 }}>›</span>
	</Link>;
}
