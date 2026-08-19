"use client";

import { useId, useState } from "react";
import { REPORT_REASONS, type ReportReasonValue } from "@/lib/report-reasons";
import type { ReportTargetType } from "@/db/schema";

type Status = "idle" | "open" | "submitting" | "sent" | "error";

/**
 * 通報ボタン。Apple 1.2対応(spec shelf-type-app-spec.md セクション11)。
 * 未ログインの訪問者にも表示するが、押すとログインを促す
 * (reports.reporter_idがNOT NULLで、通報にはログインが必須のため)。
 */
export function ReportButton({
	targetType,
	targetId,
	isLoggedIn,
}: {
	targetType: ReportTargetType;
	targetId: string;
	isLoggedIn: boolean;
}) {
	const [status, setStatus] = useState<Status>("idle");
	const [reason, setReason] = useState<ReportReasonValue>(REPORT_REASONS[0].value);
	const [message, setMessage] = useState("");
	const selectId = useId();

	if (!isLoggedIn) {
		return (
			<a href="/login" className="text-muted" style={{ fontSize: 12, textDecoration: "underline" }}>
				通報するにはログインしてください
			</a>
		);
	}

	if (status === "sent") {
		return (
			<p role="status" className="text-muted" style={{ fontSize: 12, margin: 0 }}>
				通報を受け付けました。ご協力ありがとうございます。
			</p>
		);
	}

	if (status === "idle") {
		return (
			<button
				type="button"
				className="btn btn-secondary"
				style={{ fontSize: 12, padding: "4px 10px" }}
				onClick={() => setStatus("open")}
			>
				通報する
			</button>
		);
	}

	async function submit() {
		setStatus("submitting");
		setMessage("");
		try {
			const res = await fetch("/api/reports", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ targetType, targetId, reason }),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				setStatus("error");
				setMessage(body?.message ?? "通報に失敗しました。もう一度お試しください。");
				return;
			}
			setStatus("sent");
		} catch {
			setStatus("error");
			setMessage("通信に失敗しました。接続を確認してもう一度お試しください。");
		}
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<label htmlFor={selectId} style={{ fontSize: 12 }}>
				通報理由
			</label>
			<select
				id={selectId}
				className="input"
				style={{ fontSize: 13 }}
				value={reason}
				onChange={(event) => setReason(event.target.value as ReportReasonValue)}
			>
				{REPORT_REASONS.map((r) => (
					<option key={r.value} value={r.value}>
						{r.label}
					</option>
				))}
			</select>
			<div style={{ display: "flex", gap: 6 }}>
				<button
					type="button"
					className="btn btn-primary"
					style={{ fontSize: 12, padding: "4px 10px" }}
					disabled={status === "submitting"}
					onClick={() => void submit()}
				>
					{status === "submitting" ? "送信中…" : "この内容で通報"}
				</button>
				<button
					type="button"
					className="btn btn-secondary"
					style={{ fontSize: 12, padding: "4px 10px" }}
					onClick={() => setStatus("idle")}
				>
					キャンセル
				</button>
			</div>
			{status === "error" && (
				<p role="alert" style={{ color: "var(--color-accent-800)", fontSize: 12, margin: 0 }}>
					{message}
				</p>
			)}
		</div>
	);
}
