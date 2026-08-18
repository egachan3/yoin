import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { listCategoryCounts, listShelfEntries } from "@/db/shelf";
import { TmdbAttribution } from "@/components/TmdbAttribution";
import { SUBTYPE_LABELS, aspectRatioFor, summarizeByCategory, type CategorySummary } from "@/lib/categories";
import { resolveEntryImageSrc } from "@/lib/entry-image";

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
						<CategoryCard key={category.subtype} category={category} />
					))}
				</div>
			)}

			{entries.some((entry) => entry.genre === "movie_tv") && <TmdbAttribution />}
		</main>
	);
}

/**
 * カテゴリカード1枚。565:900の縦横比(実機で2列×3行がちょうど収まる
 * サイズ感として決定済み、引き継ぎ.md 3.5節)。直近追加分(最大3件)の
 * 画像を右下から左上へ重ねて表示する(Shelfのカードの見せ方を参考にした)。
 */
function CategoryCard({ category }: { category: CategorySummary }) {
	const { subtype, count, recentEntries } = category;
	// 配列の先頭が最新(listShelfEntriesがadded_at降順のため)。
	// 古いものから先に描画してz-indexを積むと、最新が一番手前に来る
	const stack = [...recentEntries].reverse();

	return (
		<Link
			href={`/shelf/${subtype}`}
			className="card"
			style={{
				aspectRatio: "565 / 900",
				padding: 0,
				overflow: "hidden",
				textDecoration: "none",
				color: "inherit",
				display: "flex",
				flexDirection: "column",
			}}
		>
			<div style={{ position: "relative", flex: 1, background: "var(--color-accent-100)" }}>
				{stack.map((entry, i) => {
					const depthFromFront = stack.length - 1 - i;
					const src = resolveEntryImageSrc(entry);
					return (
						<div
							key={entry.id}
							style={{
								position: "absolute",
								width: "72%",
								aspectRatio: aspectRatioFor(entry.subtype),
								right: `${8 + depthFromFront * 14}%`,
								bottom: `${8 + depthFromFront * 14}%`,
								borderRadius: "var(--radius-sm)",
								overflow: "hidden",
								boxShadow: "var(--shadow-sm)",
								background: "var(--color-neutral-200)",
								zIndex: stack.length - depthFromFront,
							}}
						>
							{src && (
								// eslint-disable-next-line @next/next/no-img-element -- カード内サムネイルのため次のimage最適化は別途検討
								<img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
							)}
						</div>
					);
				})}
			</div>
			<div style={{ padding: "var(--space-2) var(--space-3)" }}>
				<p style={{ margin: 0, fontWeight: 500 }}>{SUBTYPE_LABELS[subtype]}</p>
				<p className="card-meta" style={{ marginTop: 2 }}>
					{count}件
				</p>
			</div>
		</Link>
	);
}
