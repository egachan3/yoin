import type { Kysely } from "kysely";
import type { Database } from "./schema";

/**
 * viewerとownerの間にブロック関係があるか(どちら向きでも)を調べる。
 *
 * 【実現できる範囲についての注意】spec(shelf-type-app-spec.md セクション11)より:
 * 公開棚は非ログイン・匿名の訪問者にも見られる前提のため、「プロフィール閲覧の
 * 完全な遮断」は原理的に達成できない(ログアウトすれば誰でも見られてしまう)。
 * この関数はviewerId(ログイン中のユーザー)が分かっている場合にのみ呼び出す
 * 前提で、「ログイン状態での関係性の遮断」だけを実現する。
 */
// A→Bのブロック行1件に対し、(blocker=viewer AND blocked=owner) OR
// (blocker=owner AND blocked=viewer) という条件で、viewer/ownerの
// 割り当てをどちらに入れ替えても1件ヒットすることをローカルD1で実際に
// 検証済み(2026-08-19)。逆に無関係なペアでは0件になることも確認した。
// このプロジェクトはDB問い合わせ関数自体の実行テストを持つ慣習がなく
// (既存のsrc/db/*.tsはいずれもモック経由の間接テストのみ)、新規に
// テスト用DBドライバを追加するのは今回のPRのスコープを超えるため、
// 実D1での確認結果をコメントとして残す形にした
export async function isBlocked(db: Kysely<Database>, viewerId: string, ownerId: string): Promise<boolean> {
  if (viewerId === ownerId) return false;
  const row = await db
    .selectFrom("blocks")
    .select("blocker_id")
    .where((eb) =>
      eb.or([
        eb.and([eb("blocker_id", "=", viewerId), eb("blocked_id", "=", ownerId)]),
        eb.and([eb("blocker_id", "=", ownerId), eb("blocked_id", "=", viewerId)]),
      ]),
    )
    .executeTakeFirst();
  return row !== undefined;
}
