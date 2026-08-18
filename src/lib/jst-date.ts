// カレンダー画面用の日本時間(Asia/Tokyo)日付ユーティリティ。
//
// 【なぜUTC+9固定オフセットで計算してよいのか】
// 日本にはサマータイムがなく、Asia/TokyoのUTCオフセットは通年+9時間で
// 変わらない。そのためIntl.DateTimeFormatでのタイムゾーン変換を使わずとも、
// 「UNIX秒に9時間分足してからUTCのgetter群で読む」だけで日本時間の年月日を
// 正しく求められる。
//
// 【なぜuser.timezoneを見ないのか】
// db/schema.tsのuser.timezoneはbetter-auth側のフィールドで、現状
// defaultValue "Asia/Tokyo" 固定・ユーザーからの変更手段がない
// (input: false)。将来ユーザーが任意のタイムゾーンを選べるようになったら、
// この固定オフセットをuser.timezoneベースの計算に置き換える。

const JST_OFFSET_SECONDS = 9 * 3600;

/** UNIX秒(added_at等)を"YYYY-MM-DD"の日本時間の日付キーに変換する */
export function toJstDateKey(unixSeconds: number): string {
  const d = new Date((unixSeconds + JST_OFFSET_SECONDS) * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 指定した年月(日本時間)の範囲をUNIX秒で返す。
 * startは月初0:00(JST)、endは翌月初0:00(JST)で、[start, end)の半開区間。
 * monthは1〜12。
 */
export function jstMonthRange(year: number, month: number): { start: number; end: number } {
  const startUtcMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - JST_OFFSET_SECONDS * 1000;
  const endUtcMs = Date.UTC(year, month, 1, 0, 0, 0, 0) - JST_OFFSET_SECONDS * 1000;
  return { start: Math.floor(startUtcMs / 1000), end: Math.floor(endUtcMs / 1000) };
}

/** 今日(日本時間)の"YYYY-MM-DD"キーを返す */
export function todayJstDateKey(): string {
  return toJstDateKey(Math.floor(Date.now() / 1000));
}

/** 今日(日本時間)の年月を返す */
export function todayJstYearMonth(): { year: number; month: number } {
  const [year, month] = todayJstDateKey().split("-").map(Number);
  return { year, month };
}
