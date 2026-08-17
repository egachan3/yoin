import { describe, expect, it } from "vitest";
import { sqlString, buildPurgeStatements, PLACEHOLDER_TITLE } from "./tmdb-emergency-purge.mjs";
import { TMDB_EXPIRED_PLACEHOLDER_TITLE } from "@/lib/tmdb-refresh";

describe("PLACEHOLDER_TITLE", () => {
  it("src/lib/tmdb-refresh.tsのTMDB_EXPIRED_PLACEHOLDER_TITLEと同期している", () => {
    // このスクリプトはNode単体実行のためTypeScriptを直接importできず、
    // 定数を手動で複製している。乖離を検知するための回帰テスト
    expect(PLACEHOLDER_TITLE).toBe(TMDB_EXPIRED_PLACEHOLDER_TITLE);
  });
});

describe("sqlString", () => {
  it("通常の文字列はシングルクオートで囲む", () => {
    expect(sqlString("hello")).toBe("'hello'");
  });

  it("シングルクオートを含む文字列はSQLインジェクション対策としてエスケープする", () => {
    expect(sqlString("O'Brien")).toBe("'O''Brien'");
  });

  it("複数のシングルクオートも全てエスケープする", () => {
    expect(sqlString("a'b'c")).toBe("'a''b''c'");
  });
});

describe("buildPurgeStatements", () => {
  const target = {
    source_record_id: "sr-1",
    catalog_entity_id: "ce-1",
    source_id: "movie:123",
    title: "テスト作品",
  };
  const now = 1_700_000_000;
  const statements = buildPurgeStatements(target, now);

  it("5文(BEGIN・catalog_entities更新・source_records更新・deletion_log挿入・COMMIT)を返す", () => {
    expect(statements).toHaveLength(5);
  });

  it("BEGIN TRANSACTIONで始まりCOMMITで終わる(対象1件の原子性を保証)", () => {
    expect(statements[0]).toBe("BEGIN TRANSACTION;");
    expect(statements.at(-1)).toBe("COMMIT;");
  });

  it("catalog_entitiesをプレースホルダタイトル・画像nullで更新する", () => {
    expect(statements[1]).toContain("UPDATE catalog_entities");
    expect(statements[1]).toContain(PLACEHOLDER_TITLE);
    expect(statements[1]).toContain("primary_image_ref = NULL");
    expect(statements[1]).toContain("id = 'ce-1'");
  });

  it("source_recordsをdeletion_status='deleted'に更新する(既にdeleted済みの行は対象にしないガード付き)", () => {
    expect(statements[2]).toContain("UPDATE source_records");
    expect(statements[2]).toContain("deletion_status = 'deleted'");
    expect(statements[2]).toContain("id = 'sr-1'");
    expect(statements[2]).toContain("AND deletion_status != 'deleted'");
  });

  it("deletion_logにtmdb由来として記録する", () => {
    expect(statements[3]).toContain("INSERT INTO deletion_log");
    expect(statements[3]).toContain("'tmdb'");
    expect(statements[3]).toContain("'movie:123'");
  });

  it("catalog_entity_idにシングルクオートが含まれてもエスケープされ、文字列リテラルの外に出ない(SQLインジェクション対策)", () => {
    const maliciousTarget = { ...target, catalog_entity_id: "ce-1'; DROP TABLE catalog_entities; --" };
    const escaped = buildPurgeStatements(maliciousTarget, now);
    // sqlString()がシングルクオートを''にエスケープするため、
    // 元の値のシングルクオートは文字列リテラルを閉じられない
    expect(escaped[1]).toBe(
      `UPDATE catalog_entities SET title = '${PLACEHOLDER_TITLE}', primary_image_ref = NULL, updated_at = ${now} WHERE id = 'ce-1''; DROP TABLE catalog_entities; --';`,
    );
  });
});
