import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { listCategoryCounts, listShelfEntries } from "@/db/shelf";
import { TmdbAttribution } from "@/components/TmdbAttribution";
import { summarizeByCategory } from "@/lib/categories";
import { CategoryCard } from "@/components/CategoryCard";

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
	// entriesは直近100件(画像用)、countsはLIMIT無し(カテゴリの存在・件数の正)。
	// 分ける理由はsummarizeByCategoryのコメント参照
	const [entries, counts] = await Promise.all([
		listShelfEntries(db, session.user.id),
		listCategoryCounts(db, session.user.id),
	]);
	const categories = summarizeByCategory(entries, counts);

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-2)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-6)" }}>@{session.user.handle}のコレクション</h1>

			{categories.length === 0 ? (
				<p className="text-muted">まだ何も追加されていません。右下の+から最初の1件を記録してみましょう。</p>
			) : (
				<div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "var(--space-2)" }}>
					{categories.map((category) => (
						<CategoryCard key={category.subtype} category={category} href={`/shelf/${category.subtype}`} />
					))}
				</div>
			)}

			{entries.some((entry) => entry.genre === "movie_tv") && <TmdbAttribution />}
		</main>
	);
}
