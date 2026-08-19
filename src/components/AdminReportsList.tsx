"use client";

import { useState } from "react";
import type { ReportTargetType, ReportStatus } from "@/db/schema";

export interface AdminReportRow {
	id: string;
	reporterHandle: string | null;
	targetType: ReportTargetType;
	targetLabel: string;
	reason: string;
	status: ReportStatus;
	reportedAt: number;
	resolvedAt: number | null;
}

const TARGET_TYPE_LABELS: Record<ReportTargetType, string> = {
	profile: "プロフィール",
	entry: "記録",
};

const SLA_HOURS = 24;

function formatDateTime(unixSeconds: number): string {
	return new Date(unixSeconds * 1000).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
}

function elapsedHours(unixSeconds: number): number {
	return (Date.now() / 1000 - unixSeconds) / 3600;
}

export function AdminReportsList({ initialReports }: { initialReports: AdminReportRow[] }) {
	const [reports, setReports] = useState(initialReports);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState("");

	async function resolve(id: string) {
		setPendingId(id);
		setErrorMessage("");
		try {
			const res = await fetch(`/api/admin/reports/${id}`, { method: "PATCH" });
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				setErrorMessage(body?.message ?? "対応済みへの更新に失敗しました。もう一度お試しください。");
				setPendingId(null);
				return;
			}
			setReports((prev) =>
				prev.map((r) => (r.id === id ? { ...r, status: "resolved", resolvedAt: Math.floor(Date.now() / 1000) } : r)),
			);
			setPendingId(null);
		} catch {
			setErrorMessage("通信に失敗しました。接続を確認してもう一度お試しください。");
			setPendingId(null);
		}
	}

	if (reports.length === 0) {
		return (
			<p className="text-muted" style={{ fontSize: 13 }}>
				通報はまだありません。
			</p>
		);
	}

	const pending = reports.filter((r) => r.status === "pending");
	const resolved = reports.filter((r) => r.status === "resolved");

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
			<section aria-labelledby="pending-heading">
				<h2 id="pending-heading" style={{ fontSize: 18, marginBottom: "var(--space-3)" }}>
					未対応({pending.length}件)
				</h2>
				{pending.length === 0 ? (
					<p className="text-muted" style={{ fontSize: 13 }}>
						未対応の通報はありません。
					</p>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
						{pending.map((report) => {
							const overdue = elapsedHours(report.reportedAt) >= SLA_HOURS;
							return (
								<div
									key={report.id}
									className="card"
									style={{
										gap: "var(--space-2)",
										borderColor: overdue ? "var(--color-accent-800)" : undefined,
										borderWidth: overdue ? 2 : undefined,
									}}
								>
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-2)" }}>
										<div>
											<p style={{ margin: 0, fontSize: 13 }} className="card-meta">
												{TARGET_TYPE_LABELS[report.targetType]}への通報
											</p>
											<p style={{ margin: 0, fontWeight: 600 }}>{report.targetLabel}</p>
										</div>
										{overdue && (
											<span
												style={{
													fontSize: 12,
													fontWeight: 600,
													color: "var(--color-accent-800)",
													whiteSpace: "nowrap",
												}}
											>
												24時間超過
											</span>
										)}
									</div>
									<p style={{ margin: 0, fontSize: 13 }}>理由: {report.reason}</p>
									<p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
										通報者: {report.reporterHandle ? `@${report.reporterHandle}` : "(不明)"} ・ {formatDateTime(report.reportedAt)}
									</p>
									<button
										type="button"
										className="btn btn-primary"
										style={{ fontSize: 13, alignSelf: "flex-start" }}
										disabled={pendingId === report.id}
										onClick={() => void resolve(report.id)}
									>
										{pendingId === report.id ? "更新中…" : "対応済みにする"}
									</button>
								</div>
							);
						})}
					</div>
				)}
			</section>

			<section aria-labelledby="resolved-heading">
				<h2 id="resolved-heading" style={{ fontSize: 18, marginBottom: "var(--space-3)" }}>
					対応済み({resolved.length}件)
				</h2>
				{resolved.length === 0 ? (
					<p className="text-muted" style={{ fontSize: 13 }}>
						対応済みの通報はありません。
					</p>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
						{resolved.map((report) => (
							<div key={report.id} className="card" style={{ gap: 4, opacity: 0.75 }}>
								<p style={{ margin: 0, fontSize: 13 }} className="card-meta">
									{TARGET_TYPE_LABELS[report.targetType]}への通報
								</p>
								<p style={{ margin: 0 }}>{report.targetLabel}</p>
								<p style={{ margin: 0, fontSize: 13 }}>理由: {report.reason}</p>
								<p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
									通報者: {report.reporterHandle ? `@${report.reporterHandle}` : "(不明)"} ・ 通報{formatDateTime(report.reportedAt)}
									{report.resolvedAt ? ` ・ 対応${formatDateTime(report.resolvedAt)}` : ""}
								</p>
							</div>
						))}
					</div>
				)}
			</section>

			{errorMessage && (
				<p role="alert" style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>
					{errorMessage}
				</p>
			)}
		</div>
	);
}
