"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingPage() {
	const router = useRouter();
	const [handle, setHandle] = useState("");
	const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
	const [errorMessage, setErrorMessage] = useState("");

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setStatus("submitting");
		setErrorMessage("");

		const res = await fetch("/api/onboarding/handle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ handle }),
		});

		if (res.ok) {
			router.push("/");
			return;
		}

		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		setStatus("error");
		setErrorMessage(body?.message ?? "設定に失敗しました。もう一度お試しください。");
	}

	return (
		<main style={{ maxWidth: 360, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-2)" }}>ハンドルを決める</h1>
			<p className="text-muted">
				棚の公開URLに使われます。半角英数字とアンダースコアのみ、3〜20文字。
				<br />
				<strong style={{ fontWeight: 500 }}>一度設定すると変更できません。</strong>
			</p>

			<form onSubmit={handleSubmit} style={{ marginTop: "var(--space-6)", display: "grid", gap: "var(--space-3)" }}>
				<div className="field">
					<label htmlFor="handle">ハンドル</label>
					<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
						<span className="text-muted">@</span>
						<input
							id="handle"
							type="text"
							required
							className="input"
							value={handle}
							onChange={(e) => setHandle(e.target.value)}
							placeholder="yourname"
						/>
					</div>
				</div>
				<button type="submit" className="btn btn-primary btn-block" disabled={status === "submitting"}>
					{status === "submitting" ? "設定中…" : "この内容で決定"}
				</button>
				{status === "error" && (
					<p style={{ color: "var(--color-accent-800)", fontSize: 13 }}>{errorMessage}</p>
				)}
			</form>
		</main>
	);
}
