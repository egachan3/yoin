// 手動入力フォールバック機能の共通定義(プレースホルダー画像の割り当て、日付のパース)。
// クライアント(フォーム)・サーバー(APIルート)の両方から参照するため、
// Cloudflare/Node固有のimportを持たない純粋なモジュールにする。
// 参照: shelf-type-app-spec.md セクション5.4「検索結果0件時のフォールバックUI」
//
// 【削除した定義について】
// GENRE_LABELS・STATUS_LABELS・isCompletedStatus は参照がなくなったため削除した。
// ジャンルのラベルは8カテゴリのSUBTYPE_LABELS(src/lib/categories.ts)に置き換わり、
// ステータス(予定/進行中/完了/保留/中断)はUIごと廃止された(引き継ぎ.md 3.5節)。
// DBのstatus列自体は将来の復活に備えて残してある。

import type { Genre } from "@/db/schema";

// 5分類×1種の静的プレースホルダー画像(public/placeholders/配下の固定アセット)。
// ユーザーアップロード・画像検索・外部URLはいずれも使わない(spec: モデレーション義務を避けるため)
export const MANUAL_PLACEHOLDER_IMAGE: Record<Genre, string> = {
  book: "/placeholders/book.svg",
  music: "/placeholders/music.svg",
  movie_tv: "/placeholders/movie_tv.svg",
  anime_manga: "/placeholders/anime_manga.svg",
  game: "/placeholders/game.svg",
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * <input type="date">が返す"YYYY-MM-DD"形式の文字列をUNIX秒に変換する。
 * UTC深夜0時を基準に決定的に計算する(サーバー(Cloudflare Workers、TZ=UTC想定)と
 * ブラウザ(ユーザーのローカルタイムゾーン)の両方から呼ばれ得るため、実行環境の
 * ローカルタイムゾーンに依存すると同じ入力でも結果がずれる。年月日の数値だけを
 * 見て判定することで環境非依存にする)。
 * 不正な形式・不正な日付(例: 2026-02-30)はnullを返す。
 */
export function parseManualDate(value: string): number | null {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Date.UTC(year, ...)は仕様上0〜99年を1900+年と特別解釈してしまう
  // (例: Date.UTC(50, 0, 1)は西暦1950年になる)ため使わない。
  // setUTCFullYear()にはこの特別扱いがなく、年をそのまま設定できる
  // (レビュー指摘で発見)
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  // "2026-02-30"のような桁上がりする不正な日付を弾く
  // (繰り上げ解釈されて2026-03-02になるため、往復比較で検出する)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return Math.floor(date.getTime() / 1000);
}
