import Link from "next/link";
import { SUBTYPE_LABELS, aspectRatioFor, type CategorySummary } from "@/lib/categories";
import { resolveEntryImageSrc } from "@/lib/entry-image";

/**
 * カテゴリカード1枚。565:900の縦横比(実機で2列×3行がちょうど収まる
 * サイズ感として決定済み、引き継ぎ.md 3.5節)。直近追加分(最大3件)の
 * 画像を右下から左上へ重ねて表示する(Shelfのカードの見せ方を参考にした)。
 *
 * 自分の棚(main)/page.tsxと公開棚/u/[handle]/page.tsxの両方から使う
 * 共通コンポーネント。タップ先のhrefだけが両者で異なるため引数に取る。
 */
export function CategoryCard({ category, href }: { category: CategorySummary; href: string }) {
	const { subtype, count, recentEntries } = category;
	// 配列の先頭が最新(listShelfEntriesがadded_at降順のため)。
	// 古いものから先に描画してz-indexを積むと、最新が一番手前に来る
	const stack = [...recentEntries].reverse();

	return (
		<Link
			href={href}
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
