import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { listBlockedUsers } from "@/db/blocks";
import { isAdminEmail } from "@/lib/admin";
import { ProfileSettingsForm } from "@/components/ProfileSettingsForm";
import { BlockedUsersList } from "@/components/BlockedUsersList";
import { TmdbAttribution } from "@/components/TmdbAttribution";

export default async function ProfileSettingsPage() {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session) redirect("/login");
	if (!session.user.handle_normalized || !session.user.handle) redirect("/onboarding");

	const blockedUsers = await listBlockedUsers(createDb(env.DB), session.user.id);
	const isAdmin = isAdminEmail(session.user.email, env.ADMIN_EMAILS);

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
				{isAdmin && (
					<section className="card" style={{ gap: "var(--space-3)" }} aria-labelledby="admin-heading">
						<div>
							<h2 id="admin-heading" style={{ fontSize: 20, marginBottom: 3 }}>管理</h2>
							<p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
								通報の対応状況を確認できます(ADMIN_EMAILS登録者のみ表示)。
							</p>
						</div>
						<Link href="/admin/reports" className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
							通報対応画面を開く
						</Link>
					</section>
				)}
				<section className="card" style={{ gap: "var(--space-3)" }} aria-labelledby="about-heading">
					<h2 id="about-heading" style={{ fontSize: 20, marginBottom: 3 }}>このアプリについて</h2>
					{/* TMDBの帰属表示。利用規約上「About/Credits」的なセクションへの
					    集約が公式に認められている(各コンテンツ画面への個別表示は不要)。
					    以前は棚トップ・カテゴリ詳細・公開棚・検索画面にも表示していたが、
					    この設定画面1箇所に集約した */}
					<TmdbAttribution />
				</section>
			</div>
		</main>
	);
}
