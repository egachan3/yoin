import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { listBlockedUsers } from "@/db/blocks";
import { ProfileSettingsForm } from "@/components/ProfileSettingsForm";
import { BlockedUsersList } from "@/components/BlockedUsersList";

export default async function ProfileSettingsPage() {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session) redirect("/login");
	if (!session.user.handle_normalized || !session.user.handle) redirect("/onboarding");

	const blockedUsers = await listBlockedUsers(createDb(env.DB), session.user.id);

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<header style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-6)" }}>
				<Link href="/profile" className="btn btn-secondary btn-icon" aria-label="プロフィールに戻る">‹</Link>
				<h1 style={{ fontSize: 24, margin: 0 }}>設定</h1>
			</header>
			<div style={{ display: "grid", gap: "var(--space-8)" }}>
				<ProfileSettingsForm handle={session.user.handle} isPublic={session.user.is_public ?? false} />
				<section className="card" style={{ gap: "var(--space-3)" }} aria-labelledby="blocked-users-heading">
					<div>
						<h2 id="blocked-users-heading" style={{ fontSize: 20, marginBottom: 3 }}>ブロック中のユーザー</h2>
						<p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
							ブロック中は、あなたがログインしている間はお互いの棚が表示されなくなります。
						</p>
					</div>
					<BlockedUsersList initialUsers={blockedUsers} />
				</section>
			</div>
		</main>
	);
}
