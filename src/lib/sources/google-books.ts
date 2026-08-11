// Google Books API連携。書影の補完専用(NDLは書影を持たないため)。
// 参照: shelf-type-app-spec.md セクション5.4「Google Books由来データの越境防止」
//
// - ISBN完全一致(isbn:{ISBN})でのみ叩く。NDLにISBNがない書籍は呼ばない
// - レスポンスからimageLinks配下の画像URLのみを抽出する。パース関数の戻り値の
//   型自体にtitle/description等を含めない(型レベルで越境を強制的に防ぐ)

import { z } from "zod";

const ImageLinksSchema = z.object({
  smallThumbnail: z.string().optional(),
  thumbnail: z.string().optional(),
  small: z.string().optional(),
  medium: z.string().optional(),
  large: z.string().optional(),
  extraLarge: z.string().optional(),
});

// zodのデフォルト(strip)により、volumeInfo配下のtitle/description等
// スキーマに定義していないキーはパース結果から実行時に取り除かれる。
// 戻り値の型もImageLinksのみで構成するため、呼び出し側はtitle等を
// 参照するコード自体を型として書けない(二重の防御)
const VolumesResponseSchema = z.object({
  items: z
    .array(
      z.object({
        volumeInfo: z.object({
          imageLinks: ImageLinksSchema.optional(),
        }),
      }),
    )
    .optional(),
});

export type GoogleBooksImageLinks = z.infer<typeof ImageLinksSchema>;

/**
 * ISBN完全一致で書影URLのみを取得する。見つからない/画像なしの場合はnull。
 *
 * apiKey未指定でも動作するが、匿名リクエストは共有クォータ(1日あたりの
 * 上限が極めて低い)を使うため、実運用ではAPIキーの指定が事実上必須
 * (実装時に匿名クエリで429 Quota exceededを確認済み)。
 */
export async function fetchCoverByIsbn(isbn: string, apiKey?: string): Promise<GoogleBooksImageLinks | null> {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", `isbn:${isbn}`);
  if (apiKey) {
    url.searchParams.set("key", apiKey);
  }

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    return null;
  }

  // レスポンス全体を変数として長く保持せず、パース結果(imageLinksのみ)を
  // 取り出したら即座に破棄する(title/description等をログ・キャッシュに
  // 一時的にでも書き込まないため)
  const json: unknown = await res.json();
  const parsed = VolumesResponseSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }

  const imageLinks = parsed.data.items?.[0]?.volumeInfo.imageLinks;
  return imageLinks ?? null;
}
