import Link from "next/link";
import { SUBTYPE_LABELS, aspectRatioFor, type CategorySummary } from "@/lib/categories";
import { resolveEntryImageSrc, isPlaceholderIconSrc } from "@/lib/entry-image";

// 直近3件(RECENT_ENTRIES_PER_CATEGORY)を前提にした扇状の重なり方。
// 手前(最新)を中央に正立させ、奥の2件を左右に振り分けて少し回転させる
// (global-design-system.mdの参考デザインのカード表現に寄せた構図)
const FAN_LAYOUT = [
	{ rotate: 0, offsetX: 0, offsetY: 0 },
	{ rotate: -7, offsetX: -19, offsetY: 3 },
	{ rotate: 7, offsetX: 19, offsetY: 5 },
] as const;

/**
 * カテゴリカード1枚。565:900の縦横比(実機で2列×3行がちょうど収まる
 * サイズ感として決定済み、引き継ぎ.md 3.5節)。直近追加分(最大3件)の
 * 画像を、手前(最新)を中央正立・奥2件を左右に扇状展開して重ねる
 * (Shelfのカードの見せ方を参考にした)。
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
					const fan = FAN_LAYOUT[depthFromFront] ?? FAN_LAYOUT[FAN_LAYOUT.length - 1];
					const src = resolveEntryImageSrc(entry);
					const isIcon = isPlaceholderIconSrc(src);
					return (
						<div
							key={entry.id}
							style={{
								position: "absolute",
								width: "62%",
								aspectRatio: aspectRatioFor(entry.subtype),
								left: "50%",
								top: "50%",
								transform: `translate(-50%, -50%) translate(${fan.offsetX}%, ${fan.offsetY}%) rotate(${fan.rotate}deg)`,
								borderRadius: "var(--radius-image)",
								overflow: "hidden",
								boxShadow: "var(--shadow-sm)",
								background: "var(--color-neutral-200)",
								zIndex: stack.length - depthFromFront,
							}}
						>
							{src && isIcon && (
								// eslint-disable-next-line @next/next/no-img-element -- カード内サムネイルのため次のimage最適化は別途検討
								<img
									src={src}
									alt=""
									style={{
										position: "absolute",
										top: "50%",
										left: "50%",
										transform: "translate(-50%, -50%)",
										width: "40%",
										height: "40%",
									}}
								/>
							)}
							{src && !isIcon && (
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
