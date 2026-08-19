"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "confirm" | "submitting" | "blocked" | "error";

/**
 * プロフィール画面のブロックボタン。ブロック解除はここでは行わない
 * (ブロックすると次回アクセス時にpublic-shelf.tsのisBlocked判定で
 * このページ自体が非公開表示になり、解除の導線をここに置けないため。
 * 解除は/profile/settingsのBlockedUsersListから行う)。
 */
export function BlockButton({ targetUserId, isLoggedIn }: { targetUserId: string; isLoggedIn: boolean }) {
	const router = useRouter();
	const [status, setStatus] = useState<Status>("idle");
	const [message, setMessage] = useState("");

	if (!isLoggedIn) return null;

	if (status === "blocked") {
		return (
			<p role="status" className="text-muted" style={{ fontSize: 12, margin: 0 }}>
				ブロックしました。解除は設定画面から行えます。
			</p>
		);
	}

	if (status === "idle") {
		return (
			<button
				type="button"
				className="btn btn-secondary"
				style={{ fontSize: 12, padding: "4px 10px" }}
				onClick={() => setStatus("confirm")}
			>
				ブロック
			</button>
		);
	}

	async function submit() {
		setStatus("submitting");
		setMessage("");
		try {
			const res = await fetch("/api/blocks", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ targetUserId }),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				setStatus("error");
				setMessage(body?.message ?? "ブロックに失敗しました。もう一度お試しください。");
				return;
			}
			setStatus("blocked");
			router.refresh();
		} catch {
			setStatus("error");
			setMessage("通信に失敗しました。接続を確認してもう一度お試しください。");
		}
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
			<p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
				このユーザーをブロックしますか?
			</p>
			<div style={{ display: "flex", gap: 6 }}>
				<button
					type="button"
					className="btn btn-primary"
					style={{ fontSize: 12, padding: "4px 10px" }}
					disabled={status === "submitting"}
					onClick={() => void submit()}
				>
					{status === "submitting" ? "処理中…" : "ブロックする"}
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
