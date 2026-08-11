// NDLのdcterms:extent文字列からページ数を抽出する。
// 参照: shelf-type-app-spec.md セクション5「書籍のdcterms:extentパース方針」

const NON_PAGE_UNIT_PATTERN = /枚|分|スコア|パート譜/;
const PAGE_COUNT_PATTERN = /(\d+)(?:,\d+)*\s*p/i;

/**
 * 例:
 *   "302p ; 15cm" -> 302
 *   "163,14p ; 15cm" -> 163 (最初の数値のみ採用)
 *   "１４５ｐ ; ２０ｃｍ" -> 145 (全角表記もNFKC正規化して対応)
 *   "録音ディスク 2枚 (88分) : CD" -> null (非ページ単位トークンを含む)
 *   "3冊" -> null (ページ数を持たない形式)
 */
export function parsePageCount(extentRaw: string | null): number | null {
  if (!extentRaw) return null;
  const normalized = extentRaw.normalize("NFKC");
  if (NON_PAGE_UNIT_PATTERN.test(normalized)) return null;

  const match = normalized.match(PAGE_COUNT_PATTERN);
  if (!match) return null;
  return Number(match[1]);
}

const MINUTES_PER_PAGE = 1;

/**
 * 書籍の「1ページ=1分」係数で推定消費時間(秒)を算出する。
 */
export function estimateReadingSeconds(pageCount: number | null): number | null {
  if (pageCount === null) return null;
  return pageCount * MINUTES_PER_PAGE * 60;
}
