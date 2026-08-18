import type { Kysely } from "kysely";
import type { Database, Subtype } from "./schema";

const SHELF_ENTRY_SELECT = [
  "shelf_entries.id",
  "shelf_entries.status",
  "shelf_entries.comment",
  "shelf_entries.rating",
  "shelf_entries.added_at",
  "catalog_entities.id as catalog_id",
  "catalog_entities.genre",
  // 棚の表示単位はgenreではなくsubtype(本/アルバム/曲/映画/ドラマ/
  // アニメ/マンガ/ゲームの8カテゴリ)。画像の縦横比の判定にも使う
  "catalog_entities.subtype",
  "catalog_entities.title",
  "catalog_entities.primary_image_ref",
  // 手動入力(非null)かどうかで画像の描画経路を分岐するために必要。
  // /img/{workId}/gridプロキシはowner_user_idが非nullの行を対象から除外している
  // (image-proxy.tsのresolveImageSource参照)ため、手動入力はプロキシを経由せず
  // primary_image_ref(静的プレースホルダーのパス)を直接<img>に渡す必要がある
  "catalog_entities.owner_user_id",
] as const;

/**
 * ジャンルを問わず本人の棚エントリを一覧取得する。
 * 棚トップのカテゴリ別集計(summarizeByCategory)も、この結果をJS側で
 * subtypeごとに束ねるだけで作る。SQL側でウィンドウ関数を書くより、
 * 「1回全部取ってJSで分類する」ほうが単純でバグが入りにくいと判断した。
 * 100件のLIMITを超えるユーザーでは古いエントリが集計から漏れるが、
 * 現状のスケールでは許容する(将来カテゴリ別に直接クエリする形へ変える余地あり)。
 */
export type ShelfEntryRow = Awaited<ReturnType<typeof listShelfEntries>>[number];

export async function listShelfEntries(db: Kysely<Database>, userId: string) {
  return db
    .selectFrom("shelf_entries")
    .innerJoin("catalog_entities", "catalog_entities.id", "shelf_entries.catalog_id")
    .select(SHELF_ENTRY_SELECT)
    .where("shelf_entries.user_id", "=", userId)
    .orderBy("shelf_entries.added_at", "desc")
    .limit(100)
    .execute();
}

/**
 * 特定カテゴリ(subtype)に絞った棚エントリ一覧(カテゴリ詳細画面用)。
 * こちらはカテゴリを跨がないので、DB側でsubtypeを絞り込む専用クエリにする
 * (1カテゴリに100件を超える記録がある場合でも取りこぼさないため)。
 */
export async function listShelfEntriesBySubtype(db: Kysely<Database>, userId: string, subtype: Subtype) {
  return db
    .selectFrom("shelf_entries")
    .innerJoin("catalog_entities", "catalog_entities.id", "shelf_entries.catalog_id")
    .select(SHELF_ENTRY_SELECT)
    .where("shelf_entries.user_id", "=", userId)
    .where("catalog_entities.subtype", "=", subtype)
    .orderBy("shelf_entries.added_at", "desc")
    .execute();
}
