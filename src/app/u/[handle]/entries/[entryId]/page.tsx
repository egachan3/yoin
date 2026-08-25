import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { findShelfEntryById } from "@/db/shelf";
import { EntryDetailView } from "@/components/EntryDetailView";
import { normalizeHandle } from "@/lib/handle";
import { resolvePublicShelfAccess } from "@/lib/public-shelf";

export default async function PublicEntryDetailPage({ params }: { params: Promise<{ handle: string; entryId: string }> }) {
	const { handle: handleParam, entryId } = await params;
	const { env } = await getCloudflareContext({ async: true });
	const db = createDb(env.DB);
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: await headers() });
	const access = await resolvePublicShelfAccess(db, normalizeHandle(handleParam), session?.user.id ?? null);
	if (!access || !access.allowed) notFound();

	const entry = await findShelfEntryById(db, access.ownerId, entryId);
	if (!entry) notFound();

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-6) var(--space-4) var(--space-8)" }}>
			<EntryDetailView entry={entry} backHref={`/u/${access.ownerHandle}/${entry.subtype}`} />
			{session?.user.id !== access.ownerId && (
				<Link href="/about" className="text-muted" style={{ display: "block", marginTop: "var(--space-6)", textAlign: "center", fontSize: 12 }}>このアプリについて</Link>
			)}
		</main>
	);
}
