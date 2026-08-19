// 通報理由の選択肢。reports.reasonにはこのvalueの文字列をそのまま保存する
// (別途カテゴリ列は持たず、自由記述より運用側が分類しやすい選択式に絞った)。
export const REPORT_REASONS = [
  { value: "spam", label: "スパム・宣伝目的" },
  { value: "inappropriate_content", label: "不適切なコンテンツ" },
  { value: "harassment", label: "嫌がらせ・誹謗中傷" },
  { value: "other", label: "その他" },
] as const;

export type ReportReasonValue = (typeof REPORT_REASONS)[number]["value"];

export function isReportReasonValue(value: string): value is ReportReasonValue {
  return REPORT_REASONS.some((reason) => reason.value === value);
}
