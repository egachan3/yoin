"use client";

import { useState } from "react";
import Link from "next/link";
import type { CalendarMonth } from "@/lib/calendar";
import { resolveEntryImageSrc } from "@/lib/entry-image";
import { aspectRatioFor } from "@/lib/categories";
import { SearchResultThumbnail } from "@/components/SearchResultThumbnail";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

interface CalendarViewProps {
	month: CalendarMonth;
	/** 前月・翌月リンクの遷移先("/calendar?year=2026&month=7"の形式) */
	prevHref: string;
	nextHref: string;
	/** 日本時間の今日の日付("YYYY-MM-DD")。今日のマスをハイライトするために使う */
	todayKey: string;
}

/**
 * カレンダー画面のグリッド本体。月送り(Linkでのページ遷移、サーバー側で
 * 月データを取り直す)と、日付セルのクリックによるその日の記録一覧の
 * 開閉(こちらはクライアント側の状態)の両方を持つため、クライアント
 * コンポーネントにしている(引き継ぎ.md 3.5節「カレンダー」参照)。
 */
export function CalendarView({ month, prevHref, nextHref, todayKey }: CalendarViewProps) {
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const selectedDay = month.days.find((d) => d.dateKey === selectedKey) ?? null;

	return (
		<div>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-4)" }}>
				<Link href={prevHref} className="btn btn-ghost" aria-label="前の月">
					←
				</Link>
				<p style={{ margin: 0, fontWeight: 500, fontSize: 16 }}>
					{month.year}年{month.month}月
				</p>
				<Link href={nextHref} className="btn btn-ghost" aria-label="次の月">
					→
				</Link>
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: "var(--space-2)" }}>
				{WEEKDAY_LABELS.map((label) => (
					<div key={label} style={{ textAlign: "center", fontSize: 11, color: "var(--color-text)", opacity: 0.6 }}>
						{label}
					</div>
				))}
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
				{Array.from({ length: month.leadingBlanks }).map((_, i) => (
					<div key={`blank-${i}`} />
				))}
				{month.days.map((day) => {
					const latest = day.entries[0];
					const src = latest ? resolveEntryImageSrc(latest) : null;
					const isToday = day.dateKey === todayKey;
					const isSelected = day.dateKey === selectedKey;
					return (
						<button
							key={day.dateKey}
							type="button"
							onClick={() => setSelectedKey(isSelected ? null : day.dateKey)}
							style={{
								position: "relative",
								aspectRatio: "1 / 1",
								borderRadius: "var(--radius-sm)",
								border: isToday ? "1.5px solid var(--color-accent)" : "1px solid var(--color-divider)",
								outline: isSelected ? "2px solid var(--color-accent)" : "none",
								outlineOffset: 1,
								padding: 0,
								overflow: "hidden",
								background: "var(--color-surface)",
								cursor: "pointer",
							}}
						>
							{src && (
								// eslint-disable-next-line @next/next/no-img-element -- カレンダーマス内サムネイルのため次のimage最適化は別途検討
								<img
									src={src}
									alt=""
									loading="lazy"
									style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
								/>
							)}
							<span
								style={{
									position: "absolute",
									top: 2,
									left: 4,
									fontSize: 11,
									color: src ? "#fff" : "var(--color-text)",
									textShadow: src ? "0 1px 2px rgba(0,0,0,0.6)" : "none",
								}}
							>
								{day.date}
							</span>
							{day.entries.length > 1 && (
								<span
									style={{
										position: "absolute",
										bottom: 2,
										right: 4,
										fontSize: 10,
										fontWeight: 500,
										color: "#fff",
										background: "var(--color-accent)",
										borderRadius: 999,
										padding: "0 5px",
										lineHeight: "14px",
									}}
								>
									{day.entries.length}
								</span>
							)}
						</button>
					);
				})}
			</div>

			{selectedDay && (
				<div style={{ marginTop: "var(--space-6)" }}>
					<p style={{ fontWeight: 500, marginBottom: "var(--space-3)" }}>
						{month.month}月{selectedDay.date}日の記録
					</p>
					{selectedDay.entries.length === 0 ? (
						<p className="text-muted">この日の記録はありません。</p>
					) : (
						<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
							{selectedDay.entries.map((entry) => (
								<div key={entry.id} className="card" style={{ flexDirection: "row" }}>
									<SearchResultThumbnail
										src={resolveEntryImageSrc(entry)}
										alt={entry.title}
										aspectRatio={entry.subtype === "album" || entry.subtype === "song" ? "1 / 1" : "2 / 3"}
									/>
									<div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
										<p className="card-title">{entry.title}</p>
										{entry.rating && (
											<p className="card-meta">
												{"★".repeat(entry.rating)}
												{"☆".repeat(5 - entry.rating)}
											</p>
										)}
										{entry.comment && <p style={{ fontSize: 13, margin: 0 }}>{entry.comment}</p>}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
