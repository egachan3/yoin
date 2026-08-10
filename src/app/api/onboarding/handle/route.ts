import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { validateHandle } from "@/lib/handle";

type HandleApiErrorCode =
  | "invalid_format"
  | "reserved"
  | "already_set"
  | "taken"
  | "unauthorized"
  | "rate_limited";

// Record<HandleApiErrorCode, string>にすることで、存在しないコードを渡すと
// コンパイルエラーになる(緩いRecord<string, string>だとタイポを検出できない)
const ERROR_MESSAGES: Record<HandleApiErrorCode, string> = {
  invalid_format: "3〜20文字の半角英数字・アンダースコアのみ使えます。",
  reserved: "このハンドルは予約されているため使用できません。",
  already_set: "ハンドルは一度設定すると変更できません。",
  taken: "このハンドルは既に使われています。",
  unauthorized: "ログインが必要です。",
  rate_limited: "試行回数が多すぎます。しばらくしてからお試しください。",
};

function errorResponse(code: HandleApiErrorCode, status: number) {
  return Response.json({ error: code, message: ERROR_MESSAGES[code] }, { status });
}

const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const RATE_LIMIT_MAX_ATTEMPTS = 10;

/**
 * ユーザーごとに一定時間内の試行回数を制限する。
 * KVには原子的なインクリメントがないため厳密な上限保証ではないが、
 * 候補ハンドルの連続送信による当たり調べ(どのハンドルが既に取られているか
 * の列挙)を抑止する目的の簡易な速度制限として十分(認証必須のエンドポイント
 * であり、影響が限定的なための軽量な対策)。
 */
async function checkRateLimit(kv: KVNamespace, userId: string): Promise<boolean> {
  const key = `handle-attempt:${userId}`;
  const current = await kv.get(key);
  const count = current ? Number(current) : 0;
  if (count >= RATE_LIMIT_MAX_ATTEMPTS) {
    return false;
  }
  await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return true;
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return errorResponse("unauthorized", 401);
  }

  const allowed = await checkRateLimit(env.RATE_LIMIT, session.user.id);
  if (!allowed) {
    return errorResponse("rate_limited", 429);
  }

  const body = (await request.json().catch(() => null)) as { handle?: unknown } | null;
  const rawHandle = typeof body?.handle === "string" ? body.handle : "";

  const validation = validateHandle(rawHandle);
  if (!validation.ok) {
    return errorResponse(validation.error, 422);
  }

  const db = createDb(env.DB);

  try {
    // handle_normalized IS NULLを条件に含めることで、一度設定済みのハンドルを
    // 上書きしてしまう事故を防ぐ(不変というMVP方針の徹底)。事前SELECTはせず、
    // UPDATEの更新行数だけで「既に設定済みか」を判定する(D1は行数課金のため
    // クエリ1回分の節約になる)
    const result = await db
      .updateTable("user")
      .set({
        handle: validation.display,
        handle_normalized: validation.normalized,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where("id", "=", session.user.id)
      .where("handle_normalized", "is", null)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      return errorResponse("already_set", 409);
    }
  } catch (err) {
    // このUPDATE文が触れるUNIQUE制約はuser.handle_normalizedのみ
    // (emailのUNIQUE制約はこのクエリでは対象外)なので、制約名まで見て判定する
    if (err instanceof Error && /UNIQUE constraint failed:.*handle_normalized/i.test(err.message)) {
      return errorResponse("taken", 409);
    }
    throw err;
  }

  return Response.json({ handle: validation.normalized });
}
