import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { createManualCatalogEntity } from "@/db/catalog";
import { parseManualDate } from "@/lib/manual-entry";
import { isSubtype } from "@/lib/categories";
import type { Subtype } from "@/db/schema";
import { ReviewFieldsSchema, normalizeReviewFields, parseReviewFieldsFromFormData } from "@/lib/review";

// 手動入力は外部APIへの再照会が存在しない(検索でヒットしなかった作品を記録するための
// 経路のため)。他ジャンルの追加APIと異なり、クライアントから受け取ったtitle等を
// そのままDBへ書き込む唯一の追加API(spec 5.4「手動入力は正規化から明示的に除外する」)
const AddManualEntrySchema = z.object({
  // 手動入力は必ず特定のカテゴリの検索画面から入るため、subtypeを受け取る。
  // 選択肢をここに書き下すとカテゴリ増減時にcategories.tsと食い違うため、
  // 判定はisSubtypeに委ねる(カテゴリ定義の情報源をcategories.tsに一本化する)
  subtype: z.custom<Subtype>(isSubtype),
  title: z.string().trim().min(1).max(200),
  date: z.string(),
});

// クライアント側(entries/new)でCanvasによりリサイズ+JPEG圧縮済みの前提だが、
// 改造されたクライアント・別クライアントからの直接呼び出しに備えてサーバー側でも
// 上限を設ける(圧縮後は通常数百KB程度に収まるため、これはあくまで防御的な上限)
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// multipart境界やテキストフィールド分の余裕を見て、画像上限より少し大きく取る。
// request.formData()自体がボディ全体をパース・バッファリングするため、
// 巨大なリクエストはこのチェックでパース前に弾く(レビュー指摘: パース後の
// File.sizeチェックだけだとパース自体の負荷・メモリ消費を防げない)
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
const ALLOWED_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "invalid_body", message: "画像のサイズが大きすぎます。" }, { status: 422 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return Response.json({ error: "invalid_body", message: "入力内容が不正です。" }, { status: 422 });
  }

  const parsed = AddManualEntrySchema.safeParse({
    subtype: formData.get("subtype"),
    title: formData.get("title"),
    date: formData.get("date"),
  });
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", message: "入力内容が不正です。" }, { status: 422 });
  }

  const dateSeconds = parseManualDate(parsed.data.date);
  if (dateSeconds === null) {
    return Response.json({ error: "invalid_body", message: "日付が不正です。" }, { status: 422 });
  }

  // rating/commentはFormDataの生値なので、他ルートと同じZodスキーマで
  // 範囲(1-5)・最大長(50文字)を検証してから使う
  const reviewParsed = ReviewFieldsSchema.safeParse(parseReviewFieldsFromFormData(formData));
  if (!reviewParsed.success) {
    return Response.json({ error: "invalid_body", message: "入力内容が不正です。" }, { status: 422 });
  }
  const review = normalizeReviewFields(reviewParsed.data);

  // 画像は任意。付いていれば形式・サイズを検証する(image-proxy.tsのContent-Type
  // 正規化と同じ考え方: パラメータを落として小文字化してから比較する)
  const imageField = formData.get("image");
  let imageBytes: ArrayBuffer | null = null;
  let imageContentType: string | null = null;
  if (imageField instanceof File && imageField.size > 0) {
    if (imageField.size > MAX_IMAGE_BYTES) {
      return Response.json({ error: "invalid_body", message: "画像のサイズが大きすぎます。" }, { status: 422 });
    }
    const normalizedType = imageField.type.split(";")[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_CONTENT_TYPES.includes(normalizedType)) {
      return Response.json({ error: "invalid_body", message: "対応していない画像形式です。" }, { status: 422 });
    }
    imageBytes = await imageField.arrayBuffer();
    imageContentType = normalizedType;
  }

  const db = createDb(env.DB);

  const now = Math.floor(Date.now() / 1000);
  const entryId = uuidv7();

  let catalogId: string;
  try {
    catalogId = await createManualCatalogEntity(
      db,
      env.DB,
      {
        subtype: parsed.data.subtype,
        title: parsed.data.title,
        ownerUserId: session.user.id,
      },
      {
        id: entryId,
        user_id: session.user.id,
        source_type: "manual_entry",
        // ステータス(予定/進行中/完了/保留/中断)はUIから廃止し、全ジャンルcompleted固定に
        // 統一した(引き継ぎ.md 3.5節)。DBの列は将来復活させる可能性があるため残している
        status: "completed",
        is_revisiting: 0,
        revisit_count: 0,
        comment: review.comment,
        rating: review.rating,
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
        completed_at: dateSeconds,
        created_at: now,
        updated_at: now,
      },
      imageBytes && imageContentType ? { r2: env.IMAGE_CACHE, bytes: imageBytes, contentType: imageContentType } : undefined,
    );
  } catch {
    return Response.json(
      { error: "add_failed", message: "追加に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }

  return Response.json({ id: entryId, catalogId }, { status: 201 });
}
