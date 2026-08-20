"use client";

// ReviewStep(検索経由の追加)とentries/new(手動追加フォーム)の両方で
// 星評価UIが重複していたため共通化した(reviewer指摘)。
// 単純な5段階トグルなので、ARIA仕様上roving tabindexが要求されるradiogroup/radio
// ではなく、押した/押していないを表すaria-pressedのボタン群として実装する
// (実装(素のbutton 5つ、Tabで独立フォーカス)と役割の食い違いを避けるため)
export function StarRating({
	value,
	onChange,
	disabled,
}: {
	value: number | null;
	onChange: (value: number | null) => void;
	disabled?: boolean;
}) {
	return (
		<div style={{ display: "flex", gap: 2 }} role="group" aria-label="評価">
			{[1, 2, 3, 4, 5].map((n) => {
				const filled = value !== null && value >= n;
				return (
					<button
						key={n}
						type="button"
						aria-pressed={filled}
						aria-label={`${n}点`}
						// 同じ星をもう一度押すと評価を取り消せる(評価は任意項目のため)
						onClick={() => onChange(value === n ? null : n)}
						disabled={disabled}
						style={{
							background: "transparent",
							border: "none",
							cursor: "pointer",
							padding: 2,
							fontSize: 24,
							lineHeight: 1,
							color: filled ? "var(--color-accent)" : "var(--color-divider)",
						}}
					>
						{filled ? "★" : "☆"}
					</button>
				);
			})}
		</div>
	);
}
