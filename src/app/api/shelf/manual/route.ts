import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { createManualCatalogEntity } from "@/db/catalog";
import { parseManualDate, isCompletedStatus } from "@/lib/manual-entry";

// 手動入力は外部APIへの再照会が存在しない(検索でヒットしなかった作品を記録するための
// 経路のため)。他ジャンルの追加APIと異なり、クライアントから受け取ったtitle等を
// そのままDBへ書き込む唯一の追加API(spec 5.4「手動入力は正規化から明示的に除外する」)
const AddManualEntrySchema = z.object({
  genre: z.enum(["book", "music", "movie_tv", "anime_manga", "game"]),
  title: z.string().trim().min(1).max(200),
  date: z.string(),
  status: z.enum(["planned", "in_progress", "completed", "on_hold", "dropped"]),
});

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = AddManualEntrySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", message: "入力内容が不正です。" }, { status: 422 });
  }

  const dateSeconds = parseManualDate(parsed.data.date);
  if (dateSeconds === null) {
    return Response.json({ error: "invalid_body", message: "日付が不正です。" }, { status: 422 });
  }

  const db = createDb(env.DB);

  const completed = isCompletedStatus(parsed.data.status);
  const now = Math.floor(Date.now() / 1000);
  const entryId = uuidv7();

  let catalogId: string;
  try {
    catalogId = await createManualCatalogEntity(
      db,
      env.DB,
      {
        genre: parsed.data.genre,
        title: parsed.data.title,
        ownerUserId: session.user.id,
      },
      {
        id: entryId,
        user_id: session.user.id,
        source_type: "manual_entry",
        status: parsed.data.status,
        is_revisiting: 0,
        revisit_count: 0,
        comment: null,
        rating: null,
        // 手動入力には尺データの取得元(source_records)が存在しないため、
        // 「未取得だが将来埋まりうる(pending)」ではなく構造的に対象外として扱う
        // (spec: リキャップの推定消費時間からの除外理由と同じ考え方)
        estimated_duration_seconds: null,
        duration_pending: 0,
        raw_duration_value: null,
        raw_duration_unit: null,
        // ユーザーが指定した日付をそのまま使う(バックデート記録が主用途のため、
        // 他ジャンルのように追加操作時刻=nowを機械的に使わない)
        added_at: dateSeconds,
        completed_at: completed ? dateSeconds : null,
        created_at: now,
        updated_at: now,
      },
    );
  } catch {
    return Response.json(
      { error: "add_failed", message: "追加に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }

  return Response.json({ id: entryId, catalogId }, { status: 201 });
}
