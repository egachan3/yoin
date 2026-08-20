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

/**
 * resolveEntryImageSrcが返す値が、実写真ではなく/icons/配下の
 * subtypeアイコン(小さい透過PNGグリフ、SUBTYPE_ICON参照)かどうかを判定する。
 * ユーザー写真・検索結果の書影/ジャケットは/icons/を経由しないため、
 * パスのプレフィックスだけで確実に判別できる。
 *
 * 【用途】object-fit: coverでそのまま引き伸ばすと、小さいグリフが
 * ぼやけて拡大表示されてしまう(手動追加エントリで画像未設定の場合に
 * 常に発生する、レビューではなくユーザー実機確認で発覚)。呼び出し側で
 * この判定を使い、アイコンの場合だけ中央固定サイズ表示に切り替える。
 */
export function isPlaceholderIconSrc(src: string | null): boolean {
	return src !== null && src.startsWith("/icons/");
}
