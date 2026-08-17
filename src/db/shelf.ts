import type { Kysely } from "kysely";
import type { Database } from "./schema";

/**
 * ジャンルを問わず本人の棚エントリを一覧取得する(グリッド表示用)。
 * SSR(src/app/page.tsx)とAPI(src/app/api/shelf/route.ts)の両方から
 * 同じロジックを使う(重複したクエリを別々に修正して食い違う事故を防ぐ)。
 */
export async function listShelfEntries(db: Kysely<Database>, userId: string) {
  return db
    .selectFrom("shelf_entries")
    .innerJoin("catalog_entities", "catalog_entities.id", "shelf_entries.catalog_id")
    .select([
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
    ])
    .where("shelf_entries.user_id", "=", userId)
    .orderBy("shelf_entries.added_at", "desc")
    .limit(100)
    .execute();
}
