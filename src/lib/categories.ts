// 棚のカテゴリ(subtype)に関する定義を1か所に集約する。
// 棚トップのカードも、⊕シートの選択肢も、カテゴリ詳細画面も、
// 検索画面もすべてここを参照する(定義が散らばって食い違うのを防ぐ)。
// 参照: 引き継ぎ.md 3.5節「UI全面刷新の仕様」

import type { Genre, Subtype } from "@/db/schema";
import type { ShelfEntryRow } from "@/db/shelf";

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
export function aspectRatioFor(subtype: Subtype): string {
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
 * 全ジャンル横断のエントリ一覧(listShelfEntries、added_at降順)を、
 * subtypeごとに束ねて棚トップのカード用データを作る。
 * 登録が1件もないカテゴリは結果に含めない(棚は「登録があるカテゴリだけ
 * 表示する」方針のため、引き継ぎ.md 3.5節)。
 */
export function summarizeByCategory(entries: readonly ShelfEntryRow[]): CategorySummary[] {
  const bySubtype = new Map<Subtype, ShelfEntryRow[]>();
  for (const entry of entries) {
    const list = bySubtype.get(entry.subtype);
    if (list) {
      list.push(entry);
    } else {
      bySubtype.set(entry.subtype, [entry]);
    }
  }

  return SUBTYPE_ORDER.filter((subtype) => bySubtype.has(subtype)).map((subtype) => {
    const list = bySubtype.get(subtype) as ShelfEntryRow[];
    return {
      subtype,
      count: list.length,
      // entriesは呼び出し元でadded_at降順ソート済みの前提(listShelfEntries参照)
      recentEntries: list.slice(0, RECENT_ENTRIES_PER_CATEGORY),
    };
  });
}
