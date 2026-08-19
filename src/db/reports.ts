import { uuidv7 } from "uuidv7";
import type { Kysely } from "kysely";
import type { Database, ReportTargetType } from "./schema";

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
