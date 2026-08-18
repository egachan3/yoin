import type { ShelfEntryRow } from "@/db/shelf";

/**
 * 棚エントリの画像URLを解決する。手動入力(owner_user_id非null)は
 * R2プロキシの対象外(image-proxy.tsのresolveImageSourceが構造的に除外している)
 * ため、primary_image_ref(静的プレースホルダーまたは認証付きアップロード画像の
 * パス)を直接使う。検索経由(owner_user_idがnull)は/img/{catalogId}/gridの
 * R2プロキシ経由にする。棚トップ・カテゴリ詳細の両方で同じ判定を使うため、
 * 1箇所にまとめている(以前は各画面に同じ分岐を書いていた)。
 */
export function resolveEntryImageSrc(
	entry: Pick<ShelfEntryRow, "owner_user_id" | "primary_image_ref" | "catalog_id">,
): string | null {
	if (entry.owner_user_id) {
		return entry.primary_image_ref;
	}
	if (entry.primary_image_ref) {
		return `/img/${entry.catalog_id}/grid`;
	}
	return null;
}
