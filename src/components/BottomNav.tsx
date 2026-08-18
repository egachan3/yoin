"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CategorySheet } from "./CategorySheet";

// バー全体(浮いた余白込み)の高さ(px)。layout.tsx側の本文paddingBottomと
// 同じ値を参照させることで、どちらか一方だけ変更してズレる事故を防ぐ
export const BOTTOM_NAV_HEIGHT = 88;
const PILL_HEIGHT = 56;

const TABS = [
	{
		href: "/",
		// "/"だけでなく"/shelf/xxx"(カテゴリ詳細)も「コレクション」タブの一部として扱う。
		// 単純なstartsWith("/")は全パスに一致してしまうため、この判定だけ
		// 個別に持つ(下のactive判定を参照)
		matchesPath: (pathname: string) => pathname === "/" || pathname.startsWith("/shelf/"),
		label: "コレクション",
		icon: (
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
				<rect x="3" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
				<rect x="13" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
				<rect x="3" y="14" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
				<rect x="13" y="14" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
			</svg>
		),
	},
	{
		href: "/calendar",
		matchesPath: (pathname: string) => pathname.startsWith("/calendar"),
		label: "カレンダー",
		icon: (
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
				<rect x="3.5" y="5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
				<path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="1.6" />
				<path d="M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
			</svg>
		),
	},
	{
		href: "/profile",
		matchesPath: (pathname: string) => pathname.startsWith("/profile"),
		label: "プロフィール",
		icon: (
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
				<circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
				<path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
			</svg>
		),
	},
];

/**
 * 主要3画面(棚・カレンダー・プロフィール)にだけ置く下部バー。
 * 検索画面・手動追加画面は「追加の途中」なので出さない
 * (引き継ぎ.md 3.5節。この判断により、このコンポーネントは
 * src/app/(main)/layout.tsx配下でのみレンダーする形にしている)。
 *
 * 【レイアウト】Shelfの実機画面を参考に、3タブを1つの角丸ピルでグループ化し、
 * ⊕ボタンだけをそのピルから完全に切り離して独立した円として置く
 * (当初は4つを等間隔に並べるだけの実装だったが、「タブとボタンが同じ並びの
 * 一員に見える」フィードバックを受けて構造を分けた)。
 * 外側のコンテナはpointer-events:noneにして、ピルと+ボタンの間の透明な
 * 隙間からタップがすり抜けて背後のコンテンツに届くようにしている。
 */
export function BottomNav() {
	const pathname = usePathname();
	const [sheetOpen, setSheetOpen] = useState(false);

	return (
		<>
			<div
				style={{
					position: "fixed",
					left: 0,
					right: 0,
					bottom: 0,
					zIndex: 30,
					height: BOTTOM_NAV_HEIGHT,
					boxSizing: "border-box",
					display: "flex",
					alignItems: "center",
					// ピルはflex:1で残りの幅いっぱいに伸ばし、⊕ボタンとの隙間を
					// gap:10pxの固定値にする(space-betweenだと画面幅次第で
					// 隙間が広がりすぎるため、固定値+ピルを伸ばす方式にした)。
					// 左右のpaddingはカードグリッドの左右端(var(--space-2))から、
					// さらに10pxだけ内側に寄せている
					gap: "10px",
					maxWidth: 640,
					margin: "0 auto",
					padding: "0 calc(var(--space-2) + 10px)",
					paddingBottom: "env(safe-area-inset-bottom)",
					pointerEvents: "none",
				}}
			>
				<nav
					aria-label="メインナビゲーション"
					style={{
						pointerEvents: "auto",
						flex: 1,
						display: "flex",
						alignItems: "center",
						// ピルがflex:1で伸びた分、3タブを均等配置にする
						// (伸びなかった旧実装ではタブの合計幅=ピル幅だったため
						// 指定不要だったが、今は明示しないと左に固まってしまう)
						justifyContent: "space-around",
						height: PILL_HEIGHT,
						boxSizing: "border-box",
						padding: "0 6px",
						borderRadius: 999,
						background: "var(--color-surface)",
						boxShadow: "var(--shadow-md)",
					}}
				>
					{TABS.map((tab) => {
						const active = tab.matchesPath(pathname);
						return (
							<Link
								key={tab.href}
								href={tab.href}
								aria-current={active ? "page" : undefined}
								style={{
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									gap: 1,
									textDecoration: "none",
									color: active ? "var(--color-accent)" : "var(--color-text)",
									background: active ? "var(--color-accent-100)" : "transparent",
									fontSize: 10,
									borderRadius: 999,
									padding: "6px 12px",
								}}
							>
								{tab.icon}
								{tab.label}
							</Link>
						);
					})}
				</nav>
				<button
					type="button"
					aria-label="追加"
					onClick={() => setSheetOpen(true)}
					style={{
						pointerEvents: "auto",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: PILL_HEIGHT,
						height: PILL_HEIGHT,
						flexShrink: 0,
						borderRadius: "50%",
						background: "var(--color-accent)",
						color: "var(--color-bg)",
						border: "none",
						boxShadow: "var(--shadow-md)",
						cursor: "pointer",
					}}
				>
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
					</svg>
				</button>
			</div>
			{sheetOpen && <CategorySheet onClose={() => setSheetOpen(false)} />}
		</>
	);
}
