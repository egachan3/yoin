"use client";

import { useState } from "react";

export interface BlockedUser {
	id: string;
	handle: string | null;
}

/**
 * 設定画面のブロック中ユーザー一覧。ブロック解除はここからのみ行える
 * (BlockButton.tsxのコメント参照)。
 */
export function BlockedUsersList({ initialUsers }: { initialUsers: BlockedUser[] }) {
	const [users, setUsers] = useState(initialUsers);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState("");

	async function unblock(targetUserId: string) {
		setPendingId(targetUserId);
		setErrorMessage("");
		try {
			const res = await fetch("/api/blocks", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ targetUserId }),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				setErrorMessage(body?.message ?? "解除に失敗しました。もう一度お試しください。");
				setPendingId(null);
				return;
			}
			setUsers((prev) => prev.filter((user) => user.id !== targetUserId));
			setPendingId(null);
		} catch {
			setErrorMessage("通信に失敗しました。接続を確認してもう一度お試しください。");
			setPendingId(null);
		}
	}

	if (users.length === 0) {
		return (
			<p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
				ブロック中のユーザーはいません。
			</p>
		);
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
			{users.map((user) => (
				<div
					key={user.id}
					style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}
				>
					<span style={{ fontSize: 14 }}>@{user.handle ?? "(不明なユーザー)"}</span>
					<button
						type="button"
						className="btn btn-secondary"
						style={{ fontSize: 12, padding: "4px 10px" }}
						disabled={pendingId === user.id}
						onClick={() => void unblock(user.id)}
					>
						{pendingId === user.id ? "解除中…" : "ブロック解除"}
					</button>
				</div>
			))}
			{errorMessage && (
				<p role="alert" style={{ color: "var(--color-accent-800)", fontSize: 12, margin: 0 }}>
					{errorMessage}
				</p>
			)}
		</div>
	);
}
