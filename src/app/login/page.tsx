"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
	const [email, setEmail] = useState("");
	const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

	async function handleMagicLink(e: React.FormEvent) {
		e.preventDefault();
		setStatus("sending");
		const { error } = await authClient.signIn.magicLink({
			email,
			callbackURL: "/",
		});
		setStatus(error ? "error" : "sent");
	}

	async function handleGoogle() {
		await authClient.signIn.social({ provider: "google", callbackURL: "/" });
	}

	return (
		<main style={{ maxWidth: 360, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 28, marginBottom: "var(--space-4)" }}>Yoin</h1>
			<p className="text-muted">観た・読んだ・聴いたものの余韻を、棚に並べる。</p>

			{status === "sent" ? (
				<p style={{ marginTop: "var(--space-6)" }}>
					{email} 宛にログインリンクを送りました。メールを確認してください。
				</p>
			) : (
				<form onSubmit={handleMagicLink} className="stack" style={{ marginTop: "var(--space-6)", display: "grid", gap: "var(--space-3)" }}>
					<div className="field">
						<label htmlFor="email">メールアドレス</label>
						<input
							id="email"
							type="email"
							required
							className="input"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="you@example.com"
						/>
					</div>
					<button type="submit" className="btn btn-primary btn-block" disabled={status === "sending"}>
						{status === "sending" ? "送信中…" : "ログインリンクを送る"}
					</button>
					{status === "error" && (
						<p style={{ color: "var(--color-accent-800)", fontSize: 13 }}>送信に失敗しました。もう一度お試しください。</p>
					)}
				</form>
			)}

			<div className="hr" />

			<button type="button" onClick={handleGoogle} className="btn btn-secondary btn-block">
				Googleでログイン
			</button>
		</main>
	);
}
