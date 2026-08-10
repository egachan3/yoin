-- ソーシャル機能: フォロー・ブロック・通報
-- 参照: shelf-type-app-spec.md セクション11「公開・プライバシー設計」

CREATE TABLE follows (
  follower_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id != followee_id)
);

CREATE TABLE blocks (
  blocker_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);

-- Apple 1.2対応の実体。target_type: 'profile'（ユーザープロフィール）/ 'entry'（棚エントリ、感想コメント含む）
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('profile', 'entry')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  reported_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX idx_follows_followee ON follows(followee_id);
CREATE INDEX idx_blocks_blocked ON blocks(blocked_id);
CREATE INDEX idx_reports_status ON reports(status, reported_at);
