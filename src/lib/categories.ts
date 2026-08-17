// 棚のカテゴリ(subtype)に関する定義を1か所に集約する。
// 棚トップのカードも、⊕シートの選択肢も、カテゴリ詳細画面も、
// 検索画面もすべてここを参照する(定義が散らばって食い違うのを防ぐ)。
// 参照: 引き継ぎ.md 3.5節「UI全面刷新の仕様」

import type { Genre, Subtype } from "@/db/schema";

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

/** 音楽・映像・アニメの画像比率。アルバムジャケットは正方形が通例 */
export function aspectRatioFor(subtype: Subtype): string {
  return subtype === "album" || subtype === "song" ? "1 / 1" : "2 / 3";
}

export function isSubtype(value: unknown): value is Subtype {
  return typeof value === "string" && value in SUBTYPE_LABELS;
}
