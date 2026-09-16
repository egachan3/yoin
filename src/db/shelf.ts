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
 * ジャンルを問わず本人の棚エントリを一覧取得する(直近100件、画像表示用)。
 * 棚トップのカテゴリ別集計(summarizeByCategory)は、この結果をJS側で
 * subtypeごとに束ねて「直近の画像」を作るのに使う。SQL側でウィンドウ関数を
 * 書くより、「1回全部取ってJSで分類する」ほうが単純でバグが入りにくいと判断した。
 *
 * 【重要】このLIMIT 100は「カテゴリの件数・存在」の判定には使わない。
 * 1カテゴリに大量登録すると他カテゴリの全エントリがLIMITの外に押し出され、
 * そのカテゴリカード自体が棚トップから消えてしまう(⊕シートの遷移先は
 * 追加画面のみで、カード以外に閲覧画面への導線がないため)。
 * 正確な件数・カテゴリの存在確認はlistCategoryCounts(LIMIT無し)を使う。
 */
export type ShelfEntryRow = Awaited<ReturnType<typeof listShelfEntries>>[number];

export async function listShelfEntries(db: Kysely<Database>, userId: string, publicOnly = false) {
  return db
    .selectFrom("shelf_entries")
    .innerJoin("catalog_entities", "catalog_entities.id", "shelf_entries.catalog_id")
    .select(SHELF_ENTRY_SELECT)
    .where("shelf_entries.user_id", "=", userId)
    .$if(publicOnly, (query) => query.where("shelf_entries.is_public", "=", 1))
    .orderBy("shelf_entries.added_at", "desc")
    .limit(100)
    .execute();
}

/**
 * カテゴリ(subtype)ごとの正確な件数。LIMIT無しでGROUP BYするため、
 * どれだけ記録が多いカテゴリがあっても他カテゴリの件数が欠けることがない。
 * 棚トップのカード表示に「そのカテゴリが存在するか」の判定として使う
 * (画像はlistShelfEntriesの直近100件から拾えるだけ拾う、summarizeByCategory参照)。
 */
export type CategoryCountRow = Awaited<ReturnType<typeof listCategoryCounts>>[number];

export async function listCategoryCounts(db: Kysely<Database>, userId: string, publicOnly = false) {
  return db
    .selectFrom("shelf_entries")
    .innerJoin("catalog_entities", "catalog_entities.id", "shelf_entries.catalog_id")
    .select(["catalog_entities.subtype", (eb) => eb.fn.countAll().as("count")])
    .where("shelf_entries.user_id", "=", userId)
    .$if(publicOnly, (query) => query.where("shelf_entries.is_public", "=", 1))
    .groupBy("catalog_entities.subtype")
    .execute();
}

/**
 * 特定カテゴリ(subtype)に絞った棚エントリ一覧(カテゴリ詳細画面用)。
 * こちらはカテゴリを跨がないので、DB側でsubtypeを絞り込む専用クエリにする
 * (1カテゴリに100件を超える記録がある場合でも取りこぼさないため)。
 */
export async function listShelfEntriesBySubtype(db: Kysely<Database>, userId: string, subtype: Subtype, publicOnly = false) {
  return db
    .selectFrom("shelf_entries")
    .innerJoin("catalog_entities", "catalog_entities.id", "shelf_entries.catalog_id")
    .select(SHELF_ENTRY_SELECT)
    .where("shelf_entries.user_id", "=", userId)
    .where("catalog_entities.subtype", "=", subtype)
    .$if(publicOnly, (query) => query.where("shelf_entries.is_public", "=", 1))
    .orderBy("shelf_entries.added_at", "desc")
    .execute();
}

/**
 * 本人の棚にある1件を取得する(作品個別詳細画面用)。
 * userIdも条件に含め、他ユーザーの非公開エントリをID推測で閲覧できない
 * ようにする。公開棚の詳細画面を追加する場合は、公開可否を確認した別クエリ
 * を用意すること。
 */
export async function findShelfEntryById(db: Kysely<Database>, userId: string, entryId: string) {
	return db
		.selectFrom("shelf_entries")
		.innerJoin("catalog_entities", "catalog_entities.id", "shelf_entries.catalog_id")
		.select(SHELF_ENTRY_SELECT)
		.where("shelf_entries.user_id", "=", userId)
		.where("shelf_entries.id", "=", entryId)
		.executeTakeFirst();
}

/**
 * added_atが[startInclusive, endExclusive)の範囲にある棚エントリ一覧
 * (カレンダー画面用)。範囲はjstMonthRange()で日本時間の月初〜翌月初を
 * 渡す想定。1ヶ月分なので件数の上限は設けていない。
 */
export async function listShelfEntriesByAddedRange(
  db: Kysely<Database>,
  userId: string,
  startInclusive: number,
  endExclusive: number,
) {
  return db
    .selectFrom("shelf_entries")
    .innerJoin("catalog_entities", "catalog_entities.id", "shelf_entries.catalog_id")
    .select(SHELF_ENTRY_SELECT)
    .where("shelf_entries.user_id", "=", userId)
    .where("shelf_entries.added_at", ">=", startInclusive)
    .where("shelf_entries.added_at", "<", endExclusive)
    .orderBy("shelf_entries.added_at", "desc")
    .execute();
}
