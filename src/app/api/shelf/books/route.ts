import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { findOrCreateBookCatalogEntity } from "@/db/catalog";
import { parsePageCount, estimateReadingSeconds } from "@/lib/sources/book-extent";
import { verifyBookCandidate } from "@/lib/sources/ndl";
import { ReviewFieldsSchema, normalizeReviewFields } from "@/lib/review";

// title/isbnはNDLへの再照会のヒントとしてのみ使う(下記参照)。
// creator/publisher/extentRawはクライアントから受け取らない
// (再照会結果のみを信頼する)
const AddBookSchema = z
  .object({
    ndlBibId: z.string().min(1).max(50),
    title: z.string().min(1).max(500),
    isbn: z.string().max(20).nullable(),
  })
  .extend(ReviewFieldsSchema.shape);
// 公開設定は作品単位。未指定の既存クライアントは公開扱いにする。
const AddBookSchemaWithVisibility = AddBookSchema.extend({ isPublic: z.boolean().optional() });

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = AddBookSchemaWithVisibility.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", message: "入力内容が不正です。" }, { status: 422 });
  }

  // クライアントが送ってきたtitle/isbnは「ヒント」としてのみ使い、DBへ
  // 実際に書き込む値は必ずNDLへの再照会結果を使う。クライアント値を
  // そのまま信頼すると、悪意あるユーザーが実在のndlBibIdに対して偽の
  // title等を送り込め、source_recordsのUNIQUE(source, source_id)により
  // 最初の書き込みが恒久的に正となるため、以後その本を検索する全ユーザーが
  // 偽データを共有してしまう(レビューで指摘、影響範囲が広いため対応)
  let candidate;
  try {
    candidate = await verifyBookCandidate(parsed.data.ndlBibId, parsed.data.title, parsed.data.isbn);
  } catch {
    return Response.json(
      { error: "verify_failed", message: "確認に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }
  if (!candidate) {
    return Response.json(
      { error: "not_found", message: "指定された本が見つかりませんでした。検索からやり直してください。" },
      { status: 422 },
    );
  }

  const db = createDb(env.DB);

  const pageCount = parsePageCount(candidate.extentRaw);
  const estimatedSeconds = estimateReadingSeconds(pageCount);
  const review = normalizeReviewFields(parsed.data);
  const now = Math.floor(Date.now() / 1000);
  const entryId = uuidv7();

  // catalog_entity作成(または既存再利用)とshelf_entriesの挿入を
  // findOrCreateBookCatalogEntity内で原子的に行う(レビュー指摘:
  // 以前は2段階に分かれており、後者の失敗でcatalog_entitiesが孤立行として残った)
  let catalogId: string;
  try {
    catalogId = await findOrCreateBookCatalogEntity(
      db,
      env.DB,
      candidate,
      {
        id: entryId,
        user_id: session.user.id,
        source_type: "manual_search",
        // 従来は書籍のみplanned(積読文化との整合、spec セクション5)だったが、
        // ステータスをUIから廃止したのに伴い全ジャンルcompleted固定に統一した
        // (引き継ぎ.md 3.5節)。DBの列自体は将来の復活に備えて残している
        status: "completed",
        is_revisiting: 0,
        revisit_count: 0,
        comment: review.comment,
        rating: review.rating,
        is_public: parsed.data.isPublic === false ? 0 : 1,
        estimated_duration_seconds: estimatedSeconds,
        // extentがパースできなかった場合はduration_pending=1
        // (将来のパーサー改善や手動修正で埋まり得るという扱い。
        // 永久対象外ではない、セクション5の2種類のNULLの区別)
        duration_pending: pageCount === null ? 1 : 0,
        raw_duration_value: pageCount !== null ? String(pageCount) : null,
        raw_duration_unit: pageCount !== null ? "page" : null,
        added_at: now,
        completed_at: now,
        created_at: now,
        updated_at: now,
      },
      env.GOOGLE_BOOKS_API_KEY,
    );
  } catch {
    return Response.json(
      { error: "add_failed", message: "追加に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }

  return Response.json({ id: entryId, catalogId }, { status: 201 });
}
