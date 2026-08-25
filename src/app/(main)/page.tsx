import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { listCategoryCounts, listShelfEntries } from "@/db/shelf";
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
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-6) var(--space-4) 180px" }}>
			<header style={{ display: "grid", gridTemplateColumns: "48px 1fr 48px", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-8)" }}>
				<LinkCircle href="/profile" label="プロフィール">
					<svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8"/><path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
				</LinkCircle>
				<h1 style={{ fontSize: 32, textAlign: "center", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{session.user.handle}</h1>
				{/* タイトルを中央に保つための空き領域。追加操作は下部ナビの⊕に集約する。 */}
				<div aria-hidden="true" style={{ width: 48, height: 48 }} />
			</header>

			{categories.length === 0 ? (
				<p className="text-muted">まだ何も追加されていません。右下の+から最初の1件を記録してみましょう。</p>
			) : (
				<div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "var(--space-4)" }}>
					{categories.map((category) => (
						<CategoryCard key={category.subtype} category={category} href={`/shelf/${category.subtype}`} />
					))}
				</div>
			)}
		</main>
	);
}

function LinkCircle({ href, label, children }: { href: string; label: string; children: ReactNode }) {
	return <Link href={href} aria-label={label} style={{ width: 48, height: 48, borderRadius: "50%", display: "grid", placeItems: "center", color: "var(--color-text)", background: "var(--color-surface)", border: "1px solid var(--color-divider)", textDecoration: "none" }}>{children}</Link>;
}
