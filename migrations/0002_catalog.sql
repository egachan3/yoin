-- 正規化レイヤー: catalog_entities（内部の不変ID） / source_records（ソース別の生データ）
-- 参照: shelf-type-app-spec.md セクション5「catalog_entitiesと正規化レイヤーの関係」

CREATE TABLE catalog_entities (
  id TEXT PRIMARY KEY,
  genre TEXT NOT NULL CHECK (genre IN ('book', 'music', 'movie_tv', 'anime_manga', 'game')),
  title TEXT NOT NULL,
  primary_image_ref TEXT,
  -- 手動入力エントリのみ非NULL。正規化ロジックから除外され、所有者本人の棚からのみ到達可能にする
  owner_user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  -- 将来の「昇格」機能用。手動エントリが正規カタログへ統合された際、行は消さずここに移行先を示す
  merged_into_id TEXT REFERENCES catalog_entities(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_catalog_entities_owner ON catalog_entities(owner_user_id);
CREATE INDEX idx_catalog_entities_merged_into ON catalog_entities(merged_into_id);

CREATE TABLE source_records (
  id TEXT PRIMARY KEY,
  catalog_entity_id TEXT NOT NULL REFERENCES catalog_entities(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('mal', 'tmdb', 'musicbrainz', 'ndl', 'google_books', 'igdb', 'itunes', 'cover_art_archive')),
  source_id TEXT NOT NULL,
  source_url TEXT,
  -- ソースごとの生フィールド（JSON）。Google Booksはimage系フィールドのみに限定（越境防止、セクション5.4参照）
  raw_fields TEXT NOT NULL DEFAULT '{}',
  deletion_status TEXT NOT NULL DEFAULT 'active' CHECK (deletion_status IN ('active', 'deleted', 'ttl_pending')),
  -- TMDBの6ヶ月キャッシュ上限の再取得基準（他ソースはNULLのまま）
  cached_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (source, source_id)
);

CREATE INDEX idx_source_records_catalog_entity ON source_records(catalog_entity_id);
CREATE INDEX idx_source_records_deletion_status ON source_records(source, deletion_status);
