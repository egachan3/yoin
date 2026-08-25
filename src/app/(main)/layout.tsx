import { BOTTOM_NAV_HEIGHT, BottomNav } from "@/components/BottomNav";

/**
 * 主要3画面(棚・カレンダー・プロフィール)専用のレイアウト。
 * 下部バーはこのグループの外(検索・手動追加・ログイン等)では描画されない
 * (引き継ぎ.md 3.5節: 検索・手動追加は「追加の途中」なのでバーを出さない)。
 * 認証チェックは各page側で個別に行う(層を分けても各pageがuserIdを
 * 必要とするため、結局セッション取得は避けられない。参照:src/app/(main)/page.tsx)。
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
	return (
		<>
			<div>{children}</div>
			<BottomNav />
		</>
	);
}
