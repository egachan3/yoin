-- リキャップ（MVPでは書き込まないが先に定義）・削除記録
-- 参照: shelf-type-app-spec.md セクション10・セクション5「リキャップのバッチ化に備えたスキーマ設計」

CREATE TABLE recaps (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  -- IDと自前で算出した数値のみを持つ（タイトル・画像URLは焼き込まない。catalog_entities経由で都度解決）
  payload TEXT NOT NULL,
  payload_version INTEGER NOT NULL,
  generated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, period_type, period_start)
);

-- 「もう取得してはいけないID」の突き合わせ用。中身は残さず、削除の根拠だけを残す
CREATE TABLE deletion_log (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  -- MAL側からの削除要請ならそのリファレンス番号、自主検証由来なら検証ジョブのID
  reference TEXT,
  deleted_at INTEGER NOT NULL
);

CREATE INDEX idx_deletion_log_source ON deletion_log(source, source_id);
