import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { ProfileSettingsForm } from "@/components/ProfileSettingsForm";

export default async function ProfileSettingsPage() {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session) redirect("/login");
	if (!session.user.handle_normalized || !session.user.handle) redirect("/onboarding");

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<header style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-6)" }}>
				<Link href="/profile" className="btn btn-secondary btn-icon" aria-label="プロフィールに戻る">‹</Link>
				<h1 style={{ fontSize: 24, margin: 0 }}>設定</h1>
			</header>
			<ProfileSettingsForm handle={session.user.handle} />
		</main>
	);
}
