import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { findShelfEntryById } from "@/db/shelf";
import { SUBTYPE_LABELS, aspectRatioFor } from "@/lib/categories";
import { resolveEntryImageSrc, isPlaceholderIconSrc } from "@/lib/entry-image";

export default async function EntryDetailPage({ params }: { params: Promise<{ entryId: string }> }) {
	const { entryId } = await params;
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session) redirect("/login");
	if (!session.user.handle_normalized) redirect("/onboarding");

	const db = createDb(env.DB);
	const entry = await findShelfEntryById(db, session.user.id, entryId);
	if (!entry) notFound();

	const imageSrc = resolveEntryImageSrc(entry);
	const isIcon = isPlaceholderIconSrc(imageSrc);

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-6) var(--space-4) var(--space-8)" }}>
			<Link href={`/shelf/${entry.subtype}`} aria-label="カテゴリに戻る" style={{ width: 56, height: 56, borderRadius: "50%", display: "grid", placeItems: "center", color: "var(--color-text)", background: "var(--color-surface)", border: "1px solid var(--color-divider)", textDecoration: "none", marginBottom: "var(--space-8)" }}>
				<svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 5-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
			</Link>

			<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
				<div style={{ width: "100%", aspectRatio: aspectRatioFor(entry.subtype), borderRadius: "var(--radius-image)", overflow: "hidden", background: "var(--color-neutral-200)", display: "grid", placeItems: "center", border: "1px solid var(--color-neutral-400)" }}>
					{imageSrc && isIcon && <img src={imageSrc} alt="" style={{ width: "24%", height: "auto" }} />}
					{imageSrc && !isIcon && <img src={imageSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
				</div>

				<header>
					<p className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>{SUBTYPE_LABELS[entry.subtype]}</p>
					<h1 style={{ fontSize: 36, marginBottom: "var(--space-2)" }}>{entry.title}</h1>
					<p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{formatAddedDate(entry.added_at)}</p>
				</header>

				<section className="card" aria-label="記録内容" style={{ gap: "var(--space-4)", borderRadius: "var(--radius-sm)" }}>
					<div>
						<p className="card-kicker">評価</p>
						<p style={{ fontSize: 22, letterSpacing: 2, margin: 0 }} aria-label={entry.rating ? `${entry.rating}点` : "未評価"}>
							{entry.rating ? `${"★".repeat(entry.rating)}${"☆".repeat(5 - entry.rating)}` : "未評価"}
						</p>
					</div>
					<div>
						<p className="card-kicker">感想</p>
						<p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{entry.comment || "感想はまだありません。"}</p>
					</div>
				</section>
			</div>
		</main>
	);
}

function formatAddedDate(timestamp: number) {
	return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric" }).format(new Date(timestamp * 1000));
}
