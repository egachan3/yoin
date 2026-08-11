import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";

const STATUS_LABEL: Record<string, string> = {
	planned: "積読",
	in_progress: "進行中",
	completed: "読了",
	on_hold: "中断中",
	dropped: "断念",
};

export default async function Home() {
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
	const entries = await db
		.selectFrom("shelf_entries")
		.innerJoin("catalog_entities", "catalog_entities.id", "shelf_entries.catalog_id")
		.select([
			"shelf_entries.id",
			"shelf_entries.status",
			"shelf_entries.rating",
			"catalog_entities.title",
			"catalog_entities.primary_image_ref",
		])
		.where("shelf_entries.user_id", "=", session.user.id)
		.orderBy("shelf_entries.added_at", "desc")
		.limit(100)
		.execute();

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-6)" }}>
				<h1 style={{ fontSize: 24, margin: 0 }}>@{session.user.handle}の棚</h1>
				<Link href="/search/books" className="btn btn-primary">
					本を追加
				</Link>
			</div>

			{entries.length === 0 ? (
				<p className="text-muted">まだ何も追加されていません。「本を追加」から最初の1冊を記録してみましょう。</p>
			) : (
				<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--space-3)" }}>
					{entries.map((entry) => (
						<div key={entry.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
							<div
								style={{
									aspectRatio: "2 / 3",
									background: entry.primary_image_ref ? "none" : "var(--color-accent-100)",
									backgroundImage: entry.primary_image_ref ? `url(${entry.primary_image_ref})` : undefined,
									backgroundSize: "cover",
									backgroundPosition: "center",
								}}
							/>
							<div style={{ padding: "var(--space-2) var(--space-3)" }}>
								<p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{entry.title}</p>
								<p className="card-meta" style={{ marginTop: 4 }}>
									{STATUS_LABEL[entry.status] ?? entry.status}
									{entry.rating ? ` ・ ${"★".repeat(entry.rating)}${"☆".repeat(5 - entry.rating)}` : ""}
								</p>
							</div>
						</div>
					))}
				</div>
			)}
		</main>
	);
}
