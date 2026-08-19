"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function ProfileSettingsForm({ handle, isPublic: initialIsPublic }: { handle: string; isPublic: boolean }) {
	const router = useRouter();
	const [value, setValue] = useState(handle);
	const [status, setStatus] = useState<"idle" | "saving" | "error" | "saved">("idle");
	const [message, setMessage] = useState("");
	const errorId = useId();

	const [isPublic, setIsPublic] = useState(initialIsPublic);
	const [visibilityStatus, setVisibilityStatus] = useState<"idle" | "saving" | "error">("idle");
	const [visibilityMessage, setVisibilityMessage] = useState("");

	async function toggleVisibility() {
		const next = !isPublic;
		setVisibilityStatus("saving");
		setVisibilityMessage("");
		try {
			const res = await fetch("/api/profile/visibility", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ isPublic: next }),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				setVisibilityStatus("error");
				setVisibilityMessage(body?.message ?? "変更に失敗しました。もう一度お試しください。");
				return;
			}
			setIsPublic(next);
			setVisibilityStatus("idle");
		} catch {
			setVisibilityStatus("error");
			setVisibilityMessage("通信に失敗しました。接続を確認してもう一度お試しください。");
		}
	}

	async function refreshSessionAndReturnToProfile() {
		// 直接UPDATE後の古いcookie cacheを残すと、画面遷移先に以前のハンドルが
		// 最大5分残る。disableCookieCacheでDBの最新値を取得し、新しいcache cookieを発行する。
		try {
			const { data, error } = await authClient.getSession({ query: { disableCookieCache: true } });
			if (error || !data) {
				throw new Error("セッションの更新に失敗しました。");
			}
			router.push("/profile");
			router.refresh();
		} catch {
			// 保存自体は完了している。ここでエラー状態に戻すと「保存が失敗した」と
			// 誤認させるため、再試行できる成功メッセージとして明示する。
			setStatus("saved");
			setMessage("保存しました。表示を更新するため、もう一度反映してください。");
		}
	}

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setStatus("saving");
		setMessage("");
		let response: Response;
		try {
			response = await fetch("/api/profile/handle", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ handle: value }),
			});
		} catch {
			setStatus("error");
			setMessage("通信に失敗しました。接続を確認して、もう一度お試しください。");
			return;
		}
		if (!response.ok) {
			const body = (await response.json().catch(() => null)) as { message?: string } | null;
			setStatus("error");
			setMessage(body?.message ?? "変更に失敗しました。もう一度お試しください。");
			return;
		}

		await refreshSessionAndReturnToProfile();
	}

	async function signOut() {
		await authClient.signOut({ fetchOptions: { onSuccess: () => router.push("/login") } });
	}

	return (
		<div style={{ display: "grid", gap: "var(--space-8)" }}>
			<form onSubmit={submit} className="card" style={{ gap: "var(--space-3)" }}>
				<div>
					<h2 style={{ fontSize: 20, marginBottom: 3 }}>ハンドル名</h2>
					<p className="text-muted" style={{ fontSize: 13, margin: 0 }}>プロフィールや今後の公開URLに表示されます。</p>
				</div>
				<div className="field">
					<label htmlFor="handle">ハンドル</label>
					<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
						<span className="text-muted">@</span>
						<input
							id="handle"
							className="input"
							value={value}
							onChange={(event) => setValue(event.target.value)}
							required
							minLength={3}
							maxLength={20}
							autoCapitalize="none"
							aria-invalid={status === "error"}
							aria-describedby={status === "error" ? errorId : undefined}
						/>
					</div>
				</div>
				<button type="submit" className="btn btn-primary" disabled={status === "saving"}>
					{status === "saving" ? "保存中…" : "変更を保存"}
				</button>
				{status === "error" && (
					<p id={errorId} role="alert" style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>
						{message}
					</p>
				)}
				{status === "saved" && (
					<div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
						<p role="status" className="text-muted" style={{ fontSize: 13, margin: 0 }}>
							{message}
						</p>
						<button type="button" className="btn btn-secondary" onClick={() => void refreshSessionAndReturnToProfile()}>
							もう一度反映
						</button>
					</div>
				)}
			</form>

			<section className="card" style={{ gap: "var(--space-3)" }} aria-labelledby="visibility-heading">
				<div>
					<h2 id="visibility-heading" style={{ fontSize: 20, marginBottom: 3 }}>公開設定</h2>
					<p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
						{isPublic ? (
							<>
								コレクションは誰でも閲覧できます。公開URL: <strong>@{value}</strong>
							</>
						) : (
							"コレクションは非公開です。自分以外は閲覧できません。"
						)}
					</p>
				</div>
				<button
					type="button"
					className={isPublic ? "btn btn-secondary" : "btn btn-primary"}
					onClick={() => void toggleVisibility()}
					disabled={visibilityStatus === "saving"}
				>
					{visibilityStatus === "saving" ? "変更中…" : isPublic ? "非公開にする" : "コレクションを公開する"}
				</button>
				{visibilityStatus === "error" && (
					<p role="alert" style={{ color: "var(--color-accent-800)", fontSize: 13, margin: 0 }}>
						{visibilityMessage}
					</p>
				)}
			</section>

			<section className="card" style={{ gap: "var(--space-3)" }} aria-labelledby="logout-heading">
				<div>
					<h2 id="logout-heading" style={{ fontSize: 20, marginBottom: 3 }}>ログアウト</h2>
					<p className="text-muted" style={{ fontSize: 13, margin: 0 }}>この端末でのログインを終了します。</p>
				</div>
				<button type="button" className="btn btn-secondary" onClick={signOut}>ログアウト</button>
			</section>
		</div>
	);
}
