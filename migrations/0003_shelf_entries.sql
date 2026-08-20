-- 棚エントリ: ユーザーが記録した1件1件
-- 参照: shelf-type-app-spec.md セクション5「棚エントリの状態モデル」「MVP追加機能」

CREATE TABLE shelf_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  -- NULL許容: 将来のmanual_entry（検索0件時のフォールバック）を見越した設計
  catalog_id TEXT REFERENCES catalog_entities(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('manual_search', 'share_sheet', 'manual_entry', 'auto_sync')),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'on_hold', 'dropped')),
  is_revisiting INTEGER NOT NULL DEFAULT 0,
  revisit_count INTEGER NOT NULL DEFAULT 0,
  -- 50文字以内（文字数制限はアプリ層で検証）、任意入力
  comment TEXT,
  -- 5段階（1〜5）、任意入力
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  -- 秒単位に正規化済みの推定消費時間。完了エントリ以外は集計対象外
  estimated_duration_seconds INTEGER,
  -- NULLの意味を2種類に区別する: 手動エントリ等で「永久に対象外」なら0、
  -- 「未取得だが将来埋まり得る」なら1
  duration_pending INTEGER NOT NULL DEFAULT 0,
  -- 換算係数を後日調整できるよう、正規化前の生の値も保持する（ページ数・巻数・話数等）
  raw_duration_value TEXT,
  raw_duration_unit TEXT,
  added_at INTEGER NOT NULL,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_shelf_entries_user_added ON shelf_entries(user_id, added_at);
CREATE INDEX idx_shelf_entries_user_completed ON shelf_entries(user_id, completed_at);
CREATE INDEX idx_shelf_entries_catalog ON shelf_entries(catalog_id);
