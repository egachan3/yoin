// 棚のカテゴリ(subtype)に関する定義を1か所に集約する。
// 棚トップのカードも、⊕シートの選択肢も、カテゴリ詳細画面も、
// 検索画面もすべてここを参照する(定義が散らばって食い違うのを防ぐ)。
// 参照: 引き継ぎ.md 3.5節「UI全面刷新の仕様」

import type { Genre, Subtype } from "@/db/schema";
import type { ShelfEntryRow, CategoryCountRow } from "@/db/shelf";

export const SUBTYPE_LABELS: Record<Subtype, string> = {
  book: "本",
  album: "アルバム",
  song: "曲",
  movie: "映画",
  // TMDBの語彙(tv)をそのまま保存値にしているが、UI上の呼称は「ドラマ」
  tv: "ドラマ",
  anime: "アニメ",
  manga: "マンガ",
  game: "ゲーム",
};

/**
 * 棚トップのカード、⊕シートの選択肢の並び順。
 * 同じジャンル由来のものが隣り合うように並べている。
 */
export const SUBTYPE_ORDER: readonly Subtype[] = [
  "book",
  "album",
  "song",
  "movie",
  "tv",
  "anime",
  "manga",
  "game",
] as const;

/**
 * subtypeからgenreを引く。catalog_entitiesは両方を持つので、
 * 書き込み時に片方から他方を導けるようにしておく(手で二重に指定して
 * 食い違うのを防ぐ)。
 */
export const SUBTYPE_TO_GENRE: Record<Subtype, Genre> = {
  book: "book",
  album: "music",
  song: "music",
  movie: "movie_tv",
  tv: "movie_tv",
  anime: "anime_manga",
  manga: "anime_manga",
  game: "game",
};

/**
 * ⊕シートで選んだカテゴリに対応する検索画面のパス。
 * 8カテゴリと8ルートが1対1で対応する(選んだ時点でサブカテゴリが確定するため、
 * 検索画面側にトグルは持たせない)。
 */
export const SUBTYPE_SEARCH_PATH: Record<Subtype, string> = {
  book: "/search/book",
  album: "/search/album",
  song: "/search/song",
  movie: "/search/movie",
  tv: "/search/drama",
  anime: "/search/anime",
  manga: "/search/manga",
  game: "/search/game",
};

/** アルバムと曲だけ正方形(ジャケットの通例)、他は2:3(書影・ポスターの通例) */
export function aspectRatioFor(subtype: Subtype): "1 / 1" | "2 / 3" {
  return subtype === "album" || subtype === "song" ? "1 / 1" : "2 / 3";
}

export function isSubtype(value: unknown): value is Subtype {
  // `value in SUBTYPE_LABELS`だとプロトタイプチェーンまで見るため、
  // "constructor"や"toString"がsubtypeとして通ってしまう。
  // カテゴリ定義の情報源をSUBTYPE_ORDERに一本化する意味でも、こちらで判定する
  return typeof value === "string" && (SUBTYPE_ORDER as readonly string[]).includes(value);
}

/**
 * ⊕シートの各カテゴリに添えるアイコン。public/icons/配下に用意した6種類の
 * 画像を、テレビは「ドラマ・アニメ」、本は「本・マンガ」で共有している
 * (ユーザーが用意した画像がこの6分類だったため)。
 */
export const SUBTYPE_ICON: Record<Subtype, string> = {
  book: "/icons/book.png",
  album: "/icons/album.png",
  song: "/icons/song.png",
  movie: "/icons/movie.png",
  tv: "/icons/tv.png",
  anime: "/icons/anime.png",
  manga: "/icons/manga.png",
  game: "/icons/game.png",
};

export interface CategorySummary {
  subtype: Subtype;
  count: number;
  /** 棚トップのカードに重ねて表示する、直近追加分(最大3件)の画像・タイトル */
  recentEntries: ShelfEntryRow[];
}

const RECENT_ENTRIES_PER_CATEGORY = 3;

/**
 * 棚トップのカード用データを作る。
 *
 * 【件数と画像で情報源を分けている理由】
 * countsはlistCategoryCounts(LIMIT無し・GROUP BY)の結果で、これを
 * 「そのカテゴリが存在するか」「件数は何件か」の正とする。もし
 * listShelfEntries(直近100件)だけを情報源にすると、1カテゴリに大量登録した
 * ユーザーでは他カテゴリの全エントリがLIMITの外に押し出され、そのカテゴリの
 * カード自体が棚トップから消えてしまう(⊕シートの遷移先は追加画面のみで、
 * カード以外にカテゴリの閲覧画面への導線がないため、実質そのカテゴリに
 * 二度とアクセスできなくなる)。
 *
 * recentEntriesはlistShelfEntries(直近100件、added_at降順)から拾えるだけ
 * 拾う。LIMITの外に出たカテゴリは画像が空になり、カードはプレースホルダー
 * 表示になるが、カード自体は消えない(件数はcountsから正しく出る)。
 */
export function summarizeByCategory(
  recentEntries: readonly ShelfEntryRow[],
  counts: readonly CategoryCountRow[],
): CategorySummary[] {
  const recentBySubtype = new Map<Subtype, ShelfEntryRow[]>();
  for (const entry of recentEntries) {
    const list = recentBySubtype.get(entry.subtype);
    if (list) {
      list.push(entry);
    } else {
      recentBySubtype.set(entry.subtype, [entry]);
    }
  }

  const countBySubtype = new Map<Subtype, number>();
  for (const row of counts) {
    // D1/SQLiteのCOUNT()はドライバによってstring/bigintで返ることがあるため、
    // 表示用にnumberへ正規化する
    countBySubtype.set(row.subtype, Number(row.count));
  }

  return SUBTYPE_ORDER.filter((subtype) => countBySubtype.has(subtype)).map((subtype) => ({
    subtype,
    count: countBySubtype.get(subtype) as number,
    // entriesは呼び出し元でadded_at降順ソート済みの前提(listShelfEntries参照)
    recentEntries: (recentBySubtype.get(subtype) ?? []).slice(0, RECENT_ENTRIES_PER_CATEGORY),
  }));
}
