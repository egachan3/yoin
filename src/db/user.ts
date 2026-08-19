import type { Kysely } from "kysely";
import type { Database } from "./schema";

/**
 * ハンドル(正規化済み)からユーザーを引く。公開棚ページ(/@handle)が
 * 訪問者のリクエストからユーザーを特定するのに使う。
 * 見つからない場合はnull(呼び出し側でnotFound()にする)。
 */
export async function findUserByHandle(db: Kysely<Database>, handleNormalized: string) {
  return (
    (await db
      .selectFrom("user")
      .select(["id", "handle", "is_public"])
      .where("handle_normalized", "=", handleNormalized)
      .executeTakeFirst()) ?? null
  );
}
