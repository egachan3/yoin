import type { Kysely } from "kysely";
import type { Database } from "@/db/schema";
import { findUserByHandle } from "@/db/user";
import { isBlocked } from "@/db/blocks";

export interface PublicShelfAccess {
  allowed: boolean;
  ownerId: string;
  ownerHandle: string;
}

/**
 * 「このハンドルの棚を、このviewerが見てよいか」を判定する唯一の入口。
 * 公開棚トップ・カテゴリ詳細など、公開面はすべてここを経由させる
 * (spec shelf-type-app-spec.md セクション11「表示可否の判定ロジックは
 * 1箇所に集約する」より。棚公開トグル・エントリ非表示フラグ・NSFW自動非表示は
 * 独立した軸で共存でき、表示面ごとに別々に実装すると条件を書き漏らす事故が
 * 起きるため。現状はis_publicとブロック関係の2軸のみ実装している)。
 *
 * 戻り値がnullなのは「ハンドルに対応するユーザーが存在しない」場合のみ
 * (呼び出し側でnotFound()にする)。存在するが非公開・ブロック関係にある場合は
 * allowed:falseで返す(ハンドルの存在自体は分かってしまうが、一般的なSNSの
 * 「非公開アカウントです」表示と同じ割り切り)。
 */
export async function resolvePublicShelfAccess(
  db: Kysely<Database>,
  handleNormalized: string,
  viewerId: string | null,
): Promise<PublicShelfAccess | null> {
  const owner = await findUserByHandle(db, handleNormalized);
  if (!owner || !owner.handle) return null;

  if (!owner.is_public) {
    return { allowed: false, ownerId: owner.id, ownerHandle: owner.handle };
  }

  // ブロック関係は「ログイン状態での関係性の遮断」のみ実現できる
  // (spec: 非ログインの閲覧そのものは技術的に遮断できないため)
  if (viewerId && (await isBlocked(db, viewerId, owner.id))) {
    return { allowed: false, ownerId: owner.id, ownerHandle: owner.handle };
  }

  return { allowed: true, ownerId: owner.id, ownerHandle: owner.handle };
}
