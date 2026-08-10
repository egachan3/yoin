import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { validateHandle } from "@/lib/handle";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_format: "3〜20文字の半角英数字・アンダースコアのみ使えます。",
  reserved: "このハンドルは予約されているため使用できません。",
  already_set: "ハンドルは一度設定すると変更できません。",
  taken: "このハンドルは既に使われています。",
};

function errorResponse(code: keyof typeof ERROR_MESSAGES, status: number) {
  return Response.json({ error: code, message: ERROR_MESSAGES[code] }, { status });
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { handle?: unknown } | null;
  const rawHandle = typeof body?.handle === "string" ? body.handle : "";

  const validation = validateHandle(rawHandle);
  if (!validation.ok) {
    return errorResponse(validation.error, 422);
  }

  const db = createDb(env.DB);

  // handleは不変(MVPでは変更機能を作らない)。既に設定済みなら弾く
  const currentUser = await db
    .selectFrom("user")
    .select("handle_normalized")
    .where("id", "=", session.user.id)
    .executeTakeFirst();

  if (currentUser?.handle_normalized) {
    return errorResponse("already_set", 409);
  }

  try {
    const result = await db
      .updateTable("user")
      .set({
        handle: rawHandle.normalize("NFKC").trim(),
        handle_normalized: validation.normalized,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      // handle_normalized IS NULLを条件に含めることで、二重送信・競合時に
      // 既存ハンドルを上書きしてしまう事故を防ぐ(不変というMVP方針の徹底)
      .where("id", "=", session.user.id)
      .where("handle_normalized", "is", null)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      return errorResponse("already_set", 409);
    }
  } catch (err) {
    // handle_normalizedのUNIQUE制約違反(他ユーザーと同時に同じハンドルを取り合った場合)
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      return errorResponse("taken", 409);
    }
    throw err;
  }

  return Response.json({ handle: validation.normalized });
}
