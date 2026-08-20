import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { listCategoryCounts, listShelfEntries } from "@/db/shelf";
import { normalizeHandle } from "@/lib/handle";
import { resolvePublicShelfAccess } from "@/lib/public-shelf";
import { summarizeByCategory } from "@/lib/categories";
import { CategoryCard } from "@/components/CategoryCard";
import { TmdbAttribution } from "@/components/TmdbAttribution";
import { ReportButton } from "@/components/ReportButton";
import { BlockButton } from "@/components/BlockButton";

/**
 * 公開棚トップ。/@{handle}へのアクセスがmiddleware.tsで/u/{handle}に
 * rewriteされてここに届く。ログイン不要(非ログイン・匿名の訪問者にも
 * 見られる前提、spec shelf-type-app-spec.md セクション11)。
 * レイアウトは(main)/page.tsx(自分の棚)と同じCategoryCardを再利用し、
 * タップ先だけ/u/{handle}/{subtype}に向ける。
 */
export default async function PublicShelfPage({ params }: { params: Promise<{ handle: string }> }) {
	const { handle: handleParam } = await params;
	const { env } = await getCloudflareContext({ async: true });
	const db = createDb(env.DB);

	// 未ログインの訪問者も想定するセッション取得なので、未ログインでも
	// エラーにはせずviewerId=nullとして扱う(他ページのようにredirectしない)
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

	const [entries, counts] = await Promise.all([
		listShelfEntries(db, access.ownerId),
		listCategoryCounts(db, access.ownerId),
	]);
	const categories = summarizeByCategory(entries, counts);

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					gap: "var(--space-2)",
					marginBottom: "var(--space-6)",
				}}
			>
				<h1 style={{ fontSize: 24, margin: 0 }}>@{access.ownerHandle}のコレクション</h1>
				{session?.user.id !== access.ownerId && (
					<div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
						<ReportButton targetType="profile" targetId={access.ownerId} isLoggedIn={session != null} />
						<BlockButton targetUserId={access.ownerId} isLoggedIn={session != null} />
					</div>
				)}
			</div>

			{categories.length === 0 ? (
				<p className="text-muted">まだ何も記録がありません。</p>
			) : (
				<div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "var(--space-4)" }}>
					{categories.map((category) => (
						<CategoryCard
							key={category.subtype}
							category={category}
							href={`/@${access.ownerHandle}/${category.subtype}`}
						/>
					))}
				</div>
			)}

			{/* TMDBの利用規約上、映画/TV情報を表示する画面には帰属表示が必須。
			    (main)/page.tsxと同じ条件で判定する(CategoryCard切り出し時に
			    ここだけ移し忘れていた、レビュー指摘) */}
			{entries.some((entry) => entry.genre === "movie_tv") && <TmdbAttribution />}
		</main>
	);
}
