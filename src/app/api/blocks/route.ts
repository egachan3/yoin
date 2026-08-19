import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { createBlock, deleteBlock } from "@/db/blocks";
import { checkRateLimit } from "@/lib/rate-limit";

type BlockApiErrorCode = "unauthorized" | "invalid_body" | "self_block" | "target_not_found" | "rate_limited";

const ERROR_MESSAGES: Record<BlockApiErrorCode, string> = {
	unauthorized: "ログインが必要です。",
	invalid_body: "入力内容が不正です。",
	self_block: "自分自身はブロックできません。",
	target_not_found: "対象のユーザーが見つかりません。",
	rate_limited: "試行回数が多すぎます。しばらくしてからお試しください。",
};

function errorResponse(code: BlockApiErrorCode, status: number) {
	return Response.json({ error: code, message: ERROR_MESSAGES[code] }, { status });
}

const RATE_LIMIT = { windowSeconds: 10 * 60, maxRequests: 20 };

async function readTargetUserId(request: Request): Promise<string | null> {
	const body = (await request.json().catch(() => null)) as { targetUserId?: unknown } | null;
	const targetUserId = body?.targetUserId;
	return typeof targetUserId === "string" && targetUserId.length > 0 ? targetUserId : null;
}

export async function POST(request: Request) {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) return errorResponse("unauthorized", 401);

	if (!(await checkRateLimit(env.RATE_LIMIT, "blocks", session.user.id, RATE_LIMIT))) {
		return errorResponse("rate_limited", 429);
	}

	const targetUserId = await readTargetUserId(request);
	if (!targetUserId) return errorResponse("invalid_body", 422);
	if (targetUserId === session.user.id) return errorResponse("self_block", 422);

	// targetUserIdは通常UIから正規の値(access.ownerId等)しか渡らないが、
	// APIを直接叩かれた場合に備え、存在しないユーザーIDによるFOREIGN KEY
	// 制約違反を汎用500ではなく422で返す(レビュー指摘)
	try {
		await createBlock(createDb(env.DB), session.user.id, targetUserId);
	} catch (err) {
		if (err instanceof Error && /FOREIGN KEY constraint failed/i.test(err.message)) {
			return errorResponse("target_not_found", 422);
		}
		throw err;
	}
	return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) return errorResponse("unauthorized", 401);

	if (!(await checkRateLimit(env.RATE_LIMIT, "blocks", session.user.id, RATE_LIMIT))) {
		return errorResponse("rate_limited", 429);
	}

	const targetUserId = await readTargetUserId(request);
	if (!targetUserId) return errorResponse("invalid_body", 422);

	await deleteBlock(createDb(env.DB), session.user.id, targetUserId);
	return Response.json({ ok: true });
}
