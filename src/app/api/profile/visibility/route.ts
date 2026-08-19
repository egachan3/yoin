import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { checkRateLimit } from "@/lib/rate-limit";

type VisibilityApiErrorCode = "unauthorized" | "not_onboarded" | "invalid_body" | "rate_limited";

const ERROR_MESSAGES: Record<VisibilityApiErrorCode, string> = {
	unauthorized: "ログインが必要です。",
	not_onboarded: "先にハンドルの初期設定を完了してください。",
	invalid_body: "入力内容が不正です。",
	rate_limited: "試行回数が多すぎます。しばらくしてからお試しください。",
};

function errorResponse(code: VisibilityApiErrorCode, status: number) {
	return Response.json({ error: code, message: ERROR_MESSAGES[code] }, { status });
}

// 列挙攻撃(ハンドルの存在確認)のような悪用経路はhandle/route.tsと違って
// 無い(このAPIは自分自身のis_publicしか変更できない)が、連打すれば
// D1へのUPDATEを無制限に発行できてしまう点は変わらないため、同じ形の
// 緩いレート制限を入れておく(レビュー指摘: 片方にだけ制限があると
// 「意図的な違いか見落としか」が後から読んだ人に伝わらない)
const RATE_LIMIT = { windowSeconds: 10 * 60, maxRequests: 20 };

/**
 * 棚の公開/非公開を切り替えるAPI。is_publicはbetter-auth側で
 * input:falseにしている(汎用updateUser経由では書けない)ため、専用の
 * エンドポイントからDBを直接UPDATEする(api/profile/handle/route.tsと同じ形)。
 */
export async function POST(request: Request) {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) return errorResponse("unauthorized", 401);

	if (!(await checkRateLimit(env.RATE_LIMIT, "profile-visibility", session.user.id, RATE_LIMIT))) {
		return errorResponse("rate_limited", 429);
	}

	const body = (await request.json().catch(() => null)) as { isPublic?: unknown } | null;
	if (typeof body?.isPublic !== "boolean") return errorResponse("invalid_body", 422);

	// 非公開のまま初期設定も済んでいないユーザーが公開に切り替える経路を
	// 塞ぐ(handle_normalizedが無いと/@handleの公開URL自体が成立しないため)
	const result = await createDb(env.DB)
		.updateTable("user")
		.set({
			is_public: body.isPublic ? 1 : 0,
			updatedAt: Math.floor(Date.now() / 1000),
		})
		.where("id", "=", session.user.id)
		.where("handle_normalized", "is not", null)
		.executeTakeFirst();

	if (result.numUpdatedRows === 0n) {
		return errorResponse("not_onboarded", 409);
	}

	return Response.json({ isPublic: body.isPublic });
}
