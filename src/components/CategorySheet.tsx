"use client";

import { useRouter } from "next/navigation";
import { SUBTYPE_ICON, SUBTYPE_LABELS, SUBTYPE_ORDER, SUBTYPE_SEARCH_PATH } from "@/lib/categories";

/**
 * ⊕を押すと下から出る、8カテゴリの選択シート。
 * 選ぶとそのカテゴリに固定された検索画面へ遷移する
 * (検索画面側は/search/{subtype}で、画面内トグルは持たない。PR1a参照)。
 */
export function CategorySheet({ onClose }: { onClose: () => void }) {
	const router = useRouter();

	function handleSelect(path: string) {
		onClose();
		router.push(path);
	}

	return (
		<div
			role="presentation"
			onClick={onClose}
			style={{
				position: "fixed",
				inset: 0,
				background: "color-mix(in srgb, var(--color-neutral-900) 50%, transparent)",
				zIndex: 40,
				display: "flex",
				alignItems: "flex-end",
			}}
		>
			<div
				role="dialog"
				aria-label="カテゴリを選んで追加"
				onClick={(e) => e.stopPropagation()}
				style={{
					width: "100%",
					background: "var(--color-bg)",
					borderTopLeftRadius: "var(--radius-lg)",
					borderTopRightRadius: "var(--radius-lg)",
					padding: "var(--space-4)",
					paddingBottom: "calc(var(--space-6) + env(safe-area-inset-bottom))",
				}}
			>
				<div
					aria-hidden="true"
					style={{
						width: 36,
						height: 4,
						borderRadius: 999,
						background: "var(--color-divider)",
						margin: "0 auto var(--space-4)",
					}}
				/>
				<h2 style={{ fontSize: 18, textAlign: "center", marginBottom: "var(--space-4)" }}>何を記録しますか?</h2>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(4, 1fr)",
						gap: "var(--space-3)",
					}}
				>
					{SUBTYPE_ORDER.map((subtype) => (
						<button
							key={subtype}
							type="button"
							onClick={() => handleSelect(SUBTYPE_SEARCH_PATH[subtype])}
							style={{
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								gap: "var(--space-2)",
								background: "transparent",
								border: "none",
								padding: "var(--space-2)",
								cursor: "pointer",
							}}
						>
							<span
								style={{
									width: 52,
									height: 52,
									borderRadius: "var(--radius-md)",
									background: "var(--color-accent-100)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
								}}
							>
								{/* eslint-disable-next-line @next/next/no-img-element -- 静的アセットのため次のimage最適化は不要 */}
								<img src={SUBTYPE_ICON[subtype]} alt="" style={{ width: 28, height: 28 }} />
							</span>
							{/* 本⇄マンガ、ドラマ⇄アニメは同じアイコン画像を共有しているため、
							    ラベルを太字にして誤タップを減らす(レビュー指摘) */}
							<span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>
								{SUBTYPE_LABELS[subtype]}
							</span>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
