import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { findOrCreateBookCatalogEntity } from "@/db/catalog";
import { parsePageCount, estimateReadingSeconds } from "@/lib/sources/book-extent";

const AddBookSchema = z.object({
  ndlBibId: z.string().min(1),
  title: z.string().min(1),
  creator: z.string().nullable(),
  publisher: z.string().nullable(),
  isbn: z.string().nullable(),
  extentRaw: z.string().nullable(),
});

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = AddBookSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", message: "入力内容が不正です。" }, { status: 422 });
  }

  // NOTE: ここではクライアントが検索結果からそのまま返してきた値(title/creator等)を
  // 信頼している。ndlBibIdに対して悪意あるユーザーが偽のtitle等を送ってきた場合、
  // catalog_entitiesにその偽データが最初の登録として書き込まれ、以降同じ本を
  // 検索した他ユーザーもこの偽エントリを共有してしまう(source_recordsの
  // UNIQUE(source, source_id)により先着優先のため)。MVPでは実害が小さいと
  // 判断してこの設計にしているが、本来はサーバー側でISBN等を使って
  // NDLに再照会し値を検証すべき(レビューで要検討)。
  const candidate = parsed.data;

  const db = createDb(env.DB);
  const catalogId = await findOrCreateBookCatalogEntity(db, candidate, env.GOOGLE_BOOKS_API_KEY);

  const pageCount = parsePageCount(candidate.extentRaw);
  const estimatedSeconds = estimateReadingSeconds(pageCount);
  const now = Math.floor(Date.now() / 1000);

  const entryId = uuidv7();
  await db
    .insertInto("shelf_entries")
    .values({
      id: entryId,
      user_id: session.user.id,
      catalog_id: catalogId,
      source_type: "manual_search",
      // 書籍のデフォルト状態はplanned(積読文化との整合、セクション5参照)
      status: "planned",
      is_revisiting: 0,
      revisit_count: 0,
      comment: null,
      rating: null,
      estimated_duration_seconds: estimatedSeconds,
      // extentがパースできなかった場合はduration_pending=1
      // (将来のパーサー改善や手動修正で埋まり得るという扱い。
      // 永久対象外ではない、セクション5の2種類のNULLの区別)
      duration_pending: pageCount === null ? 1 : 0,
      raw_duration_value: pageCount !== null ? String(pageCount) : null,
      raw_duration_unit: pageCount !== null ? "page" : null,
      added_at: now,
      completed_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return Response.json({ id: entryId, catalogId }, { status: 201 });
}
