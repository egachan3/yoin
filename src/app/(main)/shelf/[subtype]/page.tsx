import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
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
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-1)" }}>{SUBTYPE_LABELS[subtypeParam]}</h1>
			{/* 統計はShelfの再生回数・視聴時間のような集計は持たないため件数のみ表示する
			    (Yoinは連携機能がなく再生実績を持たないため、実データから出せる指標が件数しかない) */}
			<p className="text-muted" style={{ marginBottom: "var(--space-6)" }}>
				{entries.length}件
			</p>

			{entries.length === 0 ? (
				<p className="text-muted">まだ何も追加されていません。</p>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
					{entries.map((entry) => (
						<div key={entry.id} className="card" style={{ flexDirection: "row" }}>
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
						</div>
					))}
				</div>
			)}
		</main>
	);
}
