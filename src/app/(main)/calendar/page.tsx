import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";

/**
 * カレンダー画面の仮置き。中身(added_at基準の月表示)はPR2で実装する
 * (引き継ぎ.md 3.5節)。下部バーからの遷移先が404にならないよう、
 * 認証チェックだけ行った「準備中」表示を先に用意している。
 */
export default async function CalendarPage() {
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
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>カレンダー</h1>
			<p className="text-muted">準備中です。もうしばらくお待ちください。</p>
		</main>
	);
}
