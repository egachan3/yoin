import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { resolveReport } from "@/db/reports";
import { isAdminEmail } from "@/lib/admin";

// ページ側(admin/reports/page.tsx)の管理者チェックとは別に、API単体を
// 直接叩かれた場合に備えてここでも同じチェックを行う(他のAPIと同じ二重防御の慣習)
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
	const { id } = await context.params;
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: request.headers });

	if (!isAdminEmail(session?.user.email, env.ADMIN_EMAILS)) {
		return new Response(null, { status: 404 });
	}

	const resolved = await resolveReport(createDb(env.DB), id);
	if (!resolved) {
		return Response.json({ error: "not_found", message: "対象の通報が見つからないか、既に対応済みです。" }, { status: 404 });
	}

	return Response.json({ ok: true });
}
