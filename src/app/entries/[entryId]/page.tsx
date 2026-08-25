import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { findShelfEntryById } from "@/db/shelf";
import { EntryDetailView } from "@/components/EntryDetailView";

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

	return (
			<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-6) var(--space-4) var(--space-8)" }}>
				<EntryDetailView entry={entry} backHref={`/shelf/${entry.subtype}`} />
		</main>
	);
}
