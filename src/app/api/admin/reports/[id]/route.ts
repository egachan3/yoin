import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { resolveReport } from "@/db/reports";
import { isAdminEmail } from "@/lib/admin";
import { checkRateLimit } from "@/lib/rate-limit";

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

	// 管理者限定エンドポイントで乱用リスクは低いが、他のAPIと同じ形の
	// 緩いレート制限を一貫して掛けておく(reviewer指摘)
	if (!(await checkRateLimit(env.RATE_LIMIT, "admin-reports", session!.user.id, { windowSeconds: 60, maxRequests: 60 }))) {
		return Response.json({ error: "rate_limited", message: "試行回数が多すぎます。しばらくしてからお試しください。" }, { status: 429 });
	}

	const resolved = await resolveReport(createDb(env.DB), id);
	if (!resolved) {
		return Response.json({ error: "not_found", message: "対象の通報が見つからないか、既に対応済みです。" }, { status: 404 });
	}

	return Response.json({ ok: true });
}
