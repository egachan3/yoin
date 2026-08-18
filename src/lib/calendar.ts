import type { ShelfEntryRow } from "@/db/shelf";
import { toJstDateKey } from "./jst-date";

export interface CalendarDay {
  /** 1〜31 */
  date: number;
  /** "YYYY-MM-DD" */
  dateKey: string;
  /** その日に追加されたエントリ(added_at降順)。0件のこともある */
  entries: ShelfEntryRow[];
}

export interface CalendarMonth {
  year: number;
  month: number;
  /**
   * グリッドの先頭に入れる空白セルの数。月初の曜日(日曜=0)をそのまま使う。
   * 例: 8/1が土曜(6)なら、日〜金の6マスを空白にしてから8/1を置く
   */
  leadingBlanks: number;
  days: CalendarDay[];
}

/**
 * 指定年月のカレンダーグリッド用データを組み立てる。
 * entriesはlistShelfEntriesByAddedRange(jstMonthRangeで絞り込んだ範囲)の
 * 結果を渡す想定。月初の曜日・月の日数は、年月日の数値だけで決まる暦計算
 * (タイムゾーンに依存しない)なので、toJstDateKeyのようなUTCオフセット
 * 補正は不要 — entries側の日付振り分けだけJST基準で行う。
 */
export function buildCalendarMonth(year: number, month: number, entries: readonly ShelfEntryRow[]): CalendarMonth {
  const byDate = new Map<string, ShelfEntryRow[]>();
  for (const entry of entries) {
    const key = toJstDateKey(entry.added_at);
    const list = byDate.get(key);
    if (list) {
      list.push(entry);
    } else {
      byDate.set(key, [entry]);
    }
  }

  // 「month月0日目」=「month-1月の最終日」というJSのDateの仕様を利用して、
  // 月の日数を求める定番のイディオム
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leadingBlanks = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

  const days: CalendarDay[] = [];
  for (let date = 1; date <= daysInMonth; date++) {
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
    days.push({ date, dateKey, entries: byDate.get(dateKey) ?? [] });
  }

  return { year, month, leadingBlanks, days };
}
