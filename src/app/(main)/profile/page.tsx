import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";

/**
 * プロフィール画面の仮置き。中身(ハンドル名・プロフィールカード・
 * 記録件数の統計、右上の歯車からログアウト/ハンドル編集)はPR3で実装する
 * (引き継ぎ.md 3.5節)。下部バーからの遷移先が404にならないよう、
 * 認証チェックだけ行った「準備中」表示を先に用意している。
 */
export default async function ProfilePage() {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session) {
		redirect("/login");
	}
	if (!session.user.handle_normalized) {
		redirect("/onboarding");
	}

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>@{session.user.handle}</h1>
			<p className="text-muted">準備中です。もうしばらくお待ちください。</p>
		</main>
	);
}
