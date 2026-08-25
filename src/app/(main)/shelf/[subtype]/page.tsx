import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { listShelfEntriesBySubtype } from "@/db/shelf";
import { SUBTYPE_LABELS, isSubtype } from "@/lib/categories";
import { resolveEntryImageSrc } from "@/lib/entry-image";
import { SearchResultThumbnail } from "@/components/SearchResultThumbnail";

/**
 * カテゴリ1つ分の一覧画面。棚トップのカードをタップした先。
 * ★評価とコメントは、ステータス表示の廃止と合わせて棚トップから
 * ここに移した(引き継ぎ.md 3.5節)。
 */
export default async function CategoryDetailPage({ params }: { params: Promise<{ subtype: string }> }) {
	const { subtype: subtypeParam } = await params;
	if (!isSubtype(subtypeParam)) {
		notFound();
	}

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
	const entries = await listShelfEntriesBySubtype(db, session.user.id, subtypeParam);

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-6) var(--space-4)" }}>
			<Link href="/" aria-label="棚に戻る" style={{ width: 56, height: 56, borderRadius: "50%", display: "grid", placeItems: "center", color: "var(--color-text)", background: "var(--color-surface)", border: "1px solid var(--color-divider)", textDecoration: "none", marginBottom: "var(--space-8)" }}>
				<svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 5-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
			</Link>
			<header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)", marginBottom: "var(--space-6)" }}>
				<h1 style={{ fontSize: 32, margin: 0 }}>{SUBTYPE_LABELS[subtypeParam]}</h1>
			{/* 統計はShelfの再生回数・視聴時間のような集計は持たないため件数のみ表示する
			    (Yoinは連携機能がなく再生実績を持たないため、実データから出せる指標が件数しかない) */}
			<p className="text-muted" style={{ margin: 0, fontSize: 14 }}>
				{entries.length}件
			</p>
			</header>

			{entries.length === 0 ? (
				<p className="text-muted">まだ何も追加されていません。</p>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
					{entries.map((entry) => (
						<Link key={entry.id} href={`/entries/${entry.id}`} className="card" style={{ flexDirection: "row", alignItems: "center", padding: "var(--space-3)", borderRadius: "var(--radius-image)", borderColor: "var(--color-neutral-400)", color: "inherit", textDecoration: "none" }}>
							<SearchResultThumbnail
								src={resolveEntryImageSrc(entry)}
								alt={entry.title}
								aspectRatio={entry.subtype === "album" || entry.subtype === "song" ? "1 / 1" : "2 / 3"}
							/>
							<div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
								<p className="card-title">{entry.title}</p>
								{entry.rating && (
									<p className="card-meta">
										{"★".repeat(entry.rating)}
										{"☆".repeat(5 - entry.rating)}
									</p>
								)}
								{entry.comment && <p style={{ fontSize: 13, margin: 0 }}>{entry.comment}</p>}
							</div>
						</Link>
					))}
				</div>
			)}
		</main>
	);
}
