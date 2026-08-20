import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { listShelfEntriesBySubtype } from "@/db/shelf";
import { normalizeHandle } from "@/lib/handle";
import { resolvePublicShelfAccess } from "@/lib/public-shelf";
import { SUBTYPE_LABELS, isSubtype } from "@/lib/categories";
import { resolveEntryImageSrc } from "@/lib/entry-image";
import { SearchResultThumbnail } from "@/components/SearchResultThumbnail";
import { ReportButton } from "@/components/ReportButton";

/**
 * 公開棚のカテゴリ1つ分の一覧。/u/[handle]のカードをタップした先。
 */
export default async function PublicCategoryDetailPage({
	params,
}: {
	params: Promise<{ handle: string; subtype: string }>;
}) {
	const { handle: handleParam, subtype: subtypeParam } = await params;
	if (!isSubtype(subtypeParam)) notFound();

	const { env } = await getCloudflareContext({ async: true });
	const db = createDb(env.DB);

	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: await headers() });

	const access = await resolvePublicShelfAccess(db, normalizeHandle(handleParam), session?.user.id ?? null);
	if (!access) notFound();
	if (!access.allowed) {
		return (
			<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
				<p className="text-muted">このコレクションは非公開です。</p>
			</main>
		);
	}

	const entries = await listShelfEntriesBySubtype(db, access.ownerId, subtypeParam);

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-1)" }}>{SUBTYPE_LABELS[subtypeParam]}</h1>
			<p className="text-muted" style={{ marginBottom: "var(--space-6)" }}>
				@{access.ownerHandle} ・ {entries.length}件
			</p>

			{entries.length === 0 ? (
				<p className="text-muted">まだ何も記録がありません。</p>
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
								{session?.user.id !== access.ownerId && (
									<ReportButton targetType="entry" targetId={entry.id} isLoggedIn={session != null} />
								)}
							</div>
						</div>
					))}
				</div>
			)}
		</main>
	);
}
