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

  it("3文(catalog_entities更新・source_records更新・deletion_log挿入)を返す", () => {
    expect(statements).toHaveLength(3);
  });

  it("catalog_entitiesをプレースホルダタイトル・画像nullで更新する", () => {
    expect(statements[0]).toContain("UPDATE catalog_entities");
    expect(statements[0]).toContain(PLACEHOLDER_TITLE);
    expect(statements[0]).toContain("primary_image_ref = NULL");
    expect(statements[0]).toContain("id = 'ce-1'");
  });

  it("source_recordsをdeletion_status='deleted'に更新する", () => {
    expect(statements[1]).toContain("UPDATE source_records");
    expect(statements[1]).toContain("deletion_status = 'deleted'");
    expect(statements[1]).toContain("id = 'sr-1'");
  });

  it("deletion_logにtmdb由来として記録する", () => {
    expect(statements[2]).toContain("INSERT INTO deletion_log");
    expect(statements[2]).toContain("'tmdb'");
    expect(statements[2]).toContain("'movie:123'");
  });

  it("catalog_entity_idにシングルクオートが含まれてもエスケープされ、文字列リテラルの外に出ない(SQLインジェクション対策)", () => {
    const maliciousTarget = { ...target, catalog_entity_id: "ce-1'; DROP TABLE catalog_entities; --" };
    const escaped = buildPurgeStatements(maliciousTarget, now);
    // sqlString()がシングルクオートを''にエスケープするため、
    // 元の値のシングルクオートは文字列リテラルを閉じられない
    expect(escaped[0]).toBe(
      `UPDATE catalog_entities SET title = '${PLACEHOLDER_TITLE}', primary_image_ref = NULL, updated_at = ${now} WHERE id = 'ce-1''; DROP TABLE catalog_entities; --';`,
    );
  });
});
