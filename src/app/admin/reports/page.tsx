import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { listReportsWithDetails } from "@/db/reports";
import { isAdminEmail } from "@/lib/admin";
import { AdminReportsList } from "@/components/AdminReportsList";

/**
 * 通報対応の管理画面。Apple 1.2対応(spec shelf-type-app-spec.md セクション11)の
 * 「報告から24時間以内の対応」ワークフロー用。ロール列を持つほどの規模ではないため、
 * ADMIN_EMAILS(カンマ区切り)に登録されたメールアドレスの本人のみアクセスできる
 * (src/lib/admin.ts)。管理者以外には存在自体を教えないため404で返す。
 */
export default async function AdminReportsPage() {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: await headers() });

	if (!isAdminEmail(session?.user.email, env.ADMIN_EMAILS)) {
		notFound();
	}

	const reports = await listReportsWithDetails(createDb(env.DB));

	return (
		<main style={{ maxWidth: 720, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-2)" }}>通報対応</h1>
			<p className="text-muted" style={{ fontSize: 13, marginBottom: "var(--space-6)" }}>
				報告から24時間を超えて未対応の通報は赤く強調表示されます。
			</p>
			<AdminReportsList initialReports={reports} />
		</main>
	);
}
