import { uuidv7 } from "uuidv7";
import type { Kysely } from "kysely";
import type { Database, ReportStatus, ReportTargetType } from "./schema";

export interface CreateReportInput {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
}

/**
 * 通報を1件登録する。Apple 1.2対応(spec shelf-type-app-spec.md セクション11)。
 * statusはDB側のDEFAULT 'pending'に任せる。
 */
export async function createReport(db: Kysely<Database>, input: CreateReportInput): Promise<void> {
  await db
    .insertInto("reports")
    .values({
      id: uuidv7(),
      reporter_id: input.reporterId,
      target_type: input.targetType,
      target_id: input.targetId,
      reason: input.reason,
      reported_at: Math.floor(Date.now() / 1000),
    })
    .execute();
}

export interface ReportWithDetails {
  id: string;
  reporterHandle: string | null;
  targetType: ReportTargetType;
  targetId: string;
  /** 通報対象の人間可読なラベル(プロフィールなら@handle、エントリならタイトル+所有者) */
  targetLabel: string;
  reason: string;
  status: ReportStatus;
  reportedAt: number;
  resolvedAt: number | null;
}

/**
 * 管理画面(通報一覧)用。target_type/target_idは自由文字列で参照先テーブルが
 * 異なる(profile→user、entry→shelf_entries)ため、1回のJOINでは表現できない。
 * reports本体+reporterのhandleを取得した後、target_typeで振り分けて
 * 対象の詳細をバッチ取得しJSで結合する。
 */
export async function listReportsWithDetails(db: Kysely<Database>): Promise<ReportWithDetails[]> {
  const reports = await db
    .selectFrom("reports")
    .leftJoin("user", "user.id", "reports.reporter_id")
    .select([
      "reports.id as id",
      "reports.target_type as targetType",
      "reports.target_id as targetId",
      "reports.reason as reason",
      "reports.status as status",
      "reports.reported_at as reportedAt",
      "reports.resolved_at as resolvedAt",
      "user.handle as reporterHandle",
    ])
    // 未対応(pending)を先に、同じstatus内は新しい通報を先に表示する
    .orderBy("reports.status", "asc")
    .orderBy("reports.reported_at", "desc")
    .execute();

  const profileIds = reports.filter((r) => r.targetType === "profile").map((r) => r.targetId);
  const entryIds = reports.filter((r) => r.targetType === "entry").map((r) => r.targetId);

  const profileUsers = profileIds.length
    ? await db.selectFrom("user").select(["id", "handle"]).where("id", "in", profileIds).execute()
    : [];
  const profileHandleById = new Map(profileUsers.map((u) => [u.id, u.handle]));

  const entryRows = entryIds.length
    ? await db
        .selectFrom("shelf_entries")
        .leftJoin("catalog_entities", "catalog_entities.id", "shelf_entries.catalog_id")
        .innerJoin("user", "user.id", "shelf_entries.user_id")
        .select([
          "shelf_entries.id as entryId",
          "catalog_entities.title as title",
          "user.handle as ownerHandle",
        ])
        .where("shelf_entries.id", "in", entryIds)
        .execute()
    : [];
  const entryById = new Map(entryRows.map((e) => [e.entryId, e]));

  return reports.map((r): ReportWithDetails => {
    let targetLabel: string;
    if (r.targetType === "profile") {
      const handle = profileHandleById.get(r.targetId);
      targetLabel = handle ? `@${handle}` : "(削除済みのユーザー)";
    } else {
      const entry = entryById.get(r.targetId);
      targetLabel = entry ? `${entry.title ?? "(タイトル不明)"}(@${entry.ownerHandle})` : "(削除済みの記録)";
    }
    return {
      id: r.id,
      reporterHandle: r.reporterHandle,
      targetType: r.targetType,
      targetId: r.targetId,
      targetLabel,
      reason: r.reason,
      status: r.status,
      reportedAt: r.reportedAt,
      resolvedAt: r.resolvedAt,
    };
  });
}

/**
 * 通報を対応済みにする。既にresolved済みの行には触れない(where status='pending'で
 * 空振りさせる)ことで、resolved_atが上書きされ続ける事故を防ぐ。
 * 戻り値は実際に更新されたか(=対象がpendingで存在したか)。
 */
export async function resolveReport(db: Kysely<Database>, id: string): Promise<boolean> {
  const result = await db
    .updateTable("reports")
    .set({ status: "resolved", resolved_at: Math.floor(Date.now() / 1000) })
    .where("id", "=", id)
    .where("status", "=", "pending")
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
