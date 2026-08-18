import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { validateHandle } from "@/lib/handle";
import { checkRateLimit } from "@/lib/rate-limit";

type HandleApiErrorCode = "invalid_format" | "reserved" | "taken" | "unauthorized" | "rate_limited" | "not_onboarded";

const ERROR_MESSAGES: Record<HandleApiErrorCode, string> = {
	invalid_format: "3〜20文字の半角英数字・アンダースコアのみ使えます。",
	reserved: "このハンドルは予約されているため使用できません。",
	taken: "このハンドルは既に使われています。",
	unauthorized: "ログインが必要です。",
	rate_limited: "試行回数が多すぎます。しばらくしてからお試しください。",
	not_onboarded: "先にハンドルの初期設定を完了してください。",
};

function errorResponse(code: HandleApiErrorCode, status: number) {
	return Response.json({ error: code, message: ERROR_MESSAGES[code] }, { status });
}

// ハンドルの存在確認を利用した列挙を抑止する。オンボーディングと同じ上限だが、
// 用途を分けたキーにして初期設定での試行が設定変更を不当に塞がないようにする。
const RATE_LIMIT = { windowSeconds: 10 * 60, maxRequests: 10 };

export async function POST(request: Request) {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) return errorResponse("unauthorized", 401);

	if (!(await checkRateLimit(env.RATE_LIMIT, "profile-handle", session.user.id, RATE_LIMIT))) {
		return errorResponse("rate_limited", 429);
	}

	const body = (await request.json().catch(() => null)) as { handle?: unknown } | null;
	const rawHandle = typeof body?.handle === "string" ? body.handle : "";
	const validation = validateHandle(rawHandle);
	if (!validation.ok) return errorResponse(validation.error, 422);

	// 表記だけ(例: @Yoin → @yoin)を含めて何も変わっていない場合はDB書き込みを
	// 省く(D1は行の読み書き単位で課金されるため、無駄なUPDATEを避ける)
	if (validation.normalized === session.user.handle_normalized && validation.display === session.user.handle) {
		return Response.json({ handle: validation.display });
	}

	// 表記だけ(例: @Yoin → @yoin)の変更も許可する。normalizedが同じ本人の行は
	// UNIQUE制約に触れず、表示名だけを更新できる。
	//
	// handle_normalized IS NOT NULLを条件に含めることで、オンボーディング未完了の
	// ユーザーがこのAPIを直接叩いて初期設定をバイパスできないようにする
	// (ページ側はオンボーディング未完了なら/onboardingへredirectするが、
	// API単体を直接叩いた場合の防御はページのredirectだけでは効かないため)
	try {
		const result = await createDb(env.DB)
			.updateTable("user")
			.set({
				handle: validation.display,
				handle_normalized: validation.normalized,
				updatedAt: Math.floor(Date.now() / 1000),
			})
			.where("id", "=", session.user.id)
			.where("handle_normalized", "is not", null)
			.executeTakeFirst();

		if (result.numUpdatedRows === 0n) {
			return errorResponse("not_onboarded", 409);
		}
	} catch (err) {
		if (err instanceof Error && /UNIQUE constraint failed:.*handle_normalized/i.test(err.message)) {
			return errorResponse("taken", 409);
		}
		throw err;
	}

	return Response.json({ handle: validation.display });
}
