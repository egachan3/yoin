import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { countShelfEntries, listCategoryCounts } from "@/db/shelf";
import { SUBTYPE_LABELS, SUBTYPE_ORDER } from "@/lib/categories";
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
	const [total, categoryCounts] = await Promise.all([
		countShelfEntries(db, session.user.id),
		listCategoryCounts(db, session.user.id),
	]);
	const countBySubtype = new Map(categoryCounts.map((row) => [row.subtype, Number(row.count)]));

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", marginBottom: "var(--space-6)" }}>
				<h1 style={{ fontSize: 24, margin: 0 }}>プロフィール</h1>
				<Link href="/profile/settings" className="btn btn-secondary btn-icon" aria-label="設定">
					<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" stroke="currentColor" strokeWidth="1.7" />
						<path d="m19.4 13.5 1.2 1-.9 2.1-1.6-.1a7.8 7.8 0 0 1-1.4 1.4l.1 1.6-2.1.9-1-1.2a8.1 8.1 0 0 1-2 0l-1 1.2-2.1-.9.1-1.6a7.8 7.8 0 0 1-1.4-1.4l-1.6.1-.9-2.1 1.2-1a8.1 8.1 0 0 1 0-2l-1.2-1 .9-2.1 1.6.1a7.8 7.8 0 0 1 1.4-1.4l-.1-1.6 2.1-.9 1 1.2a8.1 8.1 0 0 1 2 0l1-1.2 2.1.9-.1 1.6a7.8 7.8 0 0 1 1.4 1.4l1.6-.1.9 2.1-1.2 1a8.1 8.1 0 0 1 0 2Z" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
					</svg>
				</Link>
			</header>

			<section className="card elev-sm" aria-label="プロフィール" style={{ alignItems: "center", padding: "var(--space-6)", textAlign: "center" }}>
				<div aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 68, height: 68, borderRadius: "50%", background: "var(--color-accent-2-200)", color: "var(--color-accent-2-800)", fontFamily: "var(--font-heading)", fontSize: 28 }}>
					{session.user.handle?.slice(0, 1).toUpperCase()}
				</div>
				<div>
					<h2 style={{ fontSize: 22, marginBottom: 2 }}>@{session.user.handle}</h2>
					<p className="text-muted" style={{ margin: 0 }}>記録したもの {total}件</p>
				</div>
			</section>

			<section style={{ marginTop: "var(--space-8)" }} aria-labelledby="stats-heading">
				<h2 id="stats-heading" style={{ fontSize: 20, marginBottom: "var(--space-3)" }}>記録の内訳</h2>
				<div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-2)" }}>
					<div className="card" style={{ background: "var(--color-accent-100)", minHeight: 88 }}>
						<span className="card-meta">全体</span>
						<strong style={{ fontFamily: "var(--font-heading)", fontSize: 28, lineHeight: 1 }}>{total}</strong>
					</div>
					{SUBTYPE_ORDER.filter((subtype) => (countBySubtype.get(subtype) ?? 0) > 0).map((subtype) => (
						<div className="card" key={subtype} style={{ minHeight: 88 }}>
							<span className="card-meta">{SUBTYPE_LABELS[subtype]}</span>
							<strong style={{ fontFamily: "var(--font-heading)", fontSize: 28, lineHeight: 1 }}>{countBySubtype.get(subtype)}</strong>
						</div>
					))}
				</div>
			</section>
		</main>
	);
}
