import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { listShelfEntriesByAddedRange } from "@/db/shelf";
import { jstMonthRange, todayJstDateKey, todayJstYearMonth } from "@/lib/jst-date";
import { buildCalendarMonth } from "@/lib/calendar";
import { CalendarView } from "@/components/CalendarView";

/**
 * "YYYY-MM-DD"のカレンダー画面。added_at基準・日本時間で日を区切る
 * (引き継ぎ.md 3.5節)。年月はURLクエリ(?year=&month=)で受け取り、
 * 不正・未指定なら今月にフォールバックする。
 */
// 手動入力のバックデート記録を考慮して広めに取るが、Date.UTC()がNaNを返す
// ような極端な値(空文字→Number("")=0、桁溢れする巨大な数値等)は弾く。
// monthだけ範囲チェックしてyearを素通りさせると、West年やyear=0のような
// 意味不明な見出しでDBにNaNの範囲クエリが飛んでしまう(レビュー指摘)
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

function parseYearMonth(yearParam: string | undefined, monthParam: string | undefined): { year: number; month: number } {
	const year = Number(yearParam);
	const month = Number(monthParam);
	if (
		!Number.isInteger(year) ||
		year < MIN_YEAR ||
		year > MAX_YEAR ||
		!Number.isInteger(month) ||
		month < 1 ||
		month > 12
	) {
		return todayJstYearMonth();
	}
	return { year, month };
}

function monthHref(year: number, month: number): string {
	return `/calendar?year=${year}&month=${month}`;
}

export default async function CalendarPage({
	searchParams,
}: {
	searchParams: Promise<{ year?: string; month?: string }>;
}) {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session) {
		redirect("/login");
	}
	if (!session.user.handle_normalized) {
		redirect("/onboarding");
	}

	const params = await searchParams;
	const { year, month } = parseYearMonth(params.year, params.month);

	const db = createDb(env.DB);
	const { start, end } = jstMonthRange(year, month);
	const entries = await listShelfEntriesByAddedRange(db, session.user.id, start, end);
	const calendarMonth = buildCalendarMonth(year, month, entries);

	// 1月始まり・12月終わりの年またぎもDate側で自然に処理される
	// (monthを0にするとJSのDateは前年12月として解釈する)
	const prev = new Date(Date.UTC(year, month - 2, 1));
	const next = new Date(Date.UTC(year, month, 1));

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>カレンダー</h1>
			<CalendarView
				// 月が変わるたびに再マウントさせ、選択中の日付(クライアント側の
				// state)を確実にリセットする。dateKeyの形式上、月が変われば
				// 選択状態は自然にnullへ落ちるが、それに暗黙で頼らずkeyで
				// 明示的に断ち切る(レビュー指摘)
				key={`${year}-${month}`}
				month={calendarMonth}
				prevHref={monthHref(prev.getUTCFullYear(), prev.getUTCMonth() + 1)}
				nextHref={monthHref(next.getUTCFullYear(), next.getUTCMonth() + 1)}
				todayKey={todayJstDateKey()}
			/>
		</main>
	);
}
