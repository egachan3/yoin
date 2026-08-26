-- 作品ごとの公開設定。既存作品は従来のコレクション公開挙動を維持するため公開扱い。
ALTER TABLE shelf_entries ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1;
