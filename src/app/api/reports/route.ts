import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { createReport } from "@/db/reports";
import { isReportReasonValue } from "@/lib/report-reasons";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ReportTargetType } from "@/db/schema";

type ReportApiErrorCode = "unauthorized" | "invalid_body" | "rate_limited";

const ERROR_MESSAGES: Record<ReportApiErrorCode, string> = {
	unauthorized: "通報するにはログインが必要です。",
	invalid_body: "入力内容が不正です。",
	rate_limited: "試行回数が多すぎます。しばらくしてからお試しください。",
};

function errorResponse(code: ReportApiErrorCode, status: number) {
	return Response.json({ error: code, message: ERROR_MESSAGES[code] }, { status });
}

const TARGET_TYPES: ReportTargetType[] = ["profile", "entry"];

// 通報の連打によるDB書き込み濫用・嫌がらせ目的の大量通報を防ぐ。
// profile/visibilityと同じ形の緩い制限(rate-limit.tsのコメント参照)。
const RATE_LIMIT = { windowSeconds: 10 * 60, maxRequests: 20 };

export async function POST(request: Request) {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) return errorResponse("unauthorized", 401);

	if (!(await checkRateLimit(env.RATE_LIMIT, "reports", session.user.id, RATE_LIMIT))) {
		return errorResponse("rate_limited", 429);
	}

	const body = (await request.json().catch(() => null)) as
		| { targetType?: unknown; targetId?: unknown; reason?: unknown }
		| null;

	const targetType = body?.targetType;
	const targetId = body?.targetId;
	const reason = body?.reason;

	if (
		typeof targetType !== "string" ||
		!TARGET_TYPES.includes(targetType as ReportTargetType) ||
		typeof targetId !== "string" ||
		targetId.length === 0 ||
		typeof reason !== "string" ||
		!isReportReasonValue(reason)
	) {
		return errorResponse("invalid_body", 422);
	}

	// reasonは表示用ラベルではなくvalue(識別子)をそのまま保存する
	// (report-reasons.tsのコメント参照。運用側が機械的にフィルタ・集計しやすくするため)
	await createReport(createDb(env.DB), {
		reporterId: session.user.id,
		targetType: targetType as ReportTargetType,
		targetId,
		reason,
	});

	return Response.json({ ok: true });
}
