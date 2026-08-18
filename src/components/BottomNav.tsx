"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CategorySheet } from "./CategorySheet";

const TABS = [
	{
		href: "/",
		label: "棚",
		icon: (
			<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
				<rect x="3" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
				<rect x="13" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
				<rect x="3" y="14" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
				<rect x="13" y="14" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
			</svg>
		),
	},
	{
		href: "/calendar",
		label: "カレンダー",
		icon: (
			<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
				<rect x="3.5" y="5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
				<path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="1.6" />
				<path d="M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
			</svg>
		),
	},
	{
		href: "/profile",
		label: "プロフィール",
		icon: (
			<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
 */
export function BottomNav() {
	const pathname = usePathname();
	const [sheetOpen, setSheetOpen] = useState(false);

	return (
		<>
			<nav
				aria-label="メインナビゲーション"
				style={{
					position: "fixed",
					left: 0,
					right: 0,
					bottom: 0,
					zIndex: 30,
					display: "flex",
					alignItems: "center",
					justifyContent: "space-around",
					padding: "var(--space-2) var(--space-4)",
					paddingBottom: "calc(var(--space-2) + env(safe-area-inset-bottom))",
					background: "var(--color-bg)",
					borderTop: "1px solid var(--color-divider)",
				}}
			>
				{TABS.map((tab) => {
					const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
					return (
						<Link
							key={tab.href}
							href={tab.href}
							aria-current={active ? "page" : undefined}
							style={{
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								gap: 2,
								textDecoration: "none",
								color: active ? "var(--color-accent)" : "var(--color-text)",
								fontSize: 11,
								padding: "var(--space-1) var(--space-2)",
							}}
						>
							{tab.icon}
							{tab.label}
						</Link>
					);
				})}
				<button
					type="button"
					aria-label="追加"
					onClick={() => setSheetOpen(true)}
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: 44,
						height: 44,
						borderRadius: "50%",
						background: "var(--color-accent)",
						color: "var(--color-bg)",
						border: "none",
						cursor: "pointer",
					}}
				>
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
					</svg>
				</button>
			</nav>
			{sheetOpen && <CategorySheet onClose={() => setSheetOpen(false)} />}
		</>
	);
}
