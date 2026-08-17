import type { ColumnType, Generated } from "kysely";

// 真偽値はSQLiteに0/1のINTEGERとして保存する
type SqliteBoolean = 0 | 1;
// UNIXタイムスタンプ（秒）。タイムゾーン変換はアプリ層で行う（IANA名はuser.timezoneに保存）
type UnixSeconds = number;

export interface UserTable {
  id: string;
  name: string;
  email: string;
  emailVerified: SqliteBoolean;
  image: string | null;
  handle: string | null;
  handle_normalized: string | null;
  timezone: ColumnType<string, string | undefined, string>;
  is_public: ColumnType<SqliteBoolean, SqliteBoolean | undefined, SqliteBoolean>;
  createdAt: UnixSeconds;
  updatedAt: UnixSeconds;
}

export interface SessionTable {
  id: string;
  expiresAt: UnixSeconds;
  token: string;
  createdAt: UnixSeconds;
  updatedAt: UnixSeconds;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
}

export interface AccountTable {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: UnixSeconds | null;
  refreshTokenExpiresAt: UnixSeconds | null;
  scope: string | null;
  password: string | null;
  createdAt: UnixSeconds;
  updatedAt: UnixSeconds;
}

export interface VerificationTable {
  id: string;
  identifier: string;
  value: string;
  expiresAt: UnixSeconds;
  createdAt: UnixSeconds | null;
  updatedAt: UnixSeconds | null;
}

export type Genre = "book" | "music" | "movie_tv" | "anime_manga" | "game";

/**
 * 棚の表示単位。genreをUI上のカテゴリまで細分化したもの
 * (音楽→アルバム/曲、映像→映画/ドラマ、アニメ・マンガ→アニメ/マンガ)。
 * ラベルやgenreとの対応はsrc/lib/categories.tsに集約している。
 */
export type Subtype = "book" | "album" | "song" | "movie" | "tv" | "anime" | "manga" | "game";

export interface CatalogEntityTable {
  id: string;
  genre: Genre;
  /**
   * DBのカラム定義はNULL許容だが、ここでは非nullとして扱う。
   * SQLiteは後付けのNOT NULL列にデフォルト値を要求するため、意味のない
   * デフォルト('book'等)で埋めると渡し忘れが黙って通ってしまう。
   * 必須性は型で担保し、渡し忘れをビルド時に止める(migrations/0006参照)。
   */
  subtype: Subtype;
  title: string;
  primary_image_ref: string | null;
  owner_user_id: string | null;
  merged_into_id: string | null;
  created_at: UnixSeconds;
  updated_at: UnixSeconds;
}

export type CatalogSource =
  | "mal"
  | "tmdb"
  | "musicbrainz"
  | "ndl"
  | "google_books"
  | "igdb"
  | "itunes"
  | "cover_art_archive";

export type DeletionStatus = "active" | "deleted" | "ttl_pending";

export interface SourceRecordTable {
  id: string;
  catalog_entity_id: string;
  source: CatalogSource;
  source_id: string;
  source_url: string | null;
  // ソースごとの生フィールド(JSON文字列)。Google Booksはimage系のみに限定(セクション5.4参照)
  raw_fields: ColumnType<string, string | undefined, string>;
  deletion_status: ColumnType<DeletionStatus, DeletionStatus | undefined, DeletionStatus>;
  cached_at: UnixSeconds | null;
  created_at: UnixSeconds;
  updated_at: UnixSeconds;
}

export type ShelfEntrySourceType = "manual_search" | "share_sheet" | "manual_entry" | "auto_sync";
export type ShelfEntryStatus = "planned" | "in_progress" | "completed" | "on_hold" | "dropped";

export interface ShelfEntryTable {
  id: string;
  user_id: string;
  catalog_id: string | null;
  source_type: ShelfEntrySourceType;
  status: ColumnType<ShelfEntryStatus, ShelfEntryStatus | undefined, ShelfEntryStatus>;
  is_revisiting: ColumnType<SqliteBoolean, SqliteBoolean | undefined, SqliteBoolean>;
  revisit_count: ColumnType<number, number | undefined, number>;
  // 30文字以内(アプリ層で検証)
  comment: string | null;
  // 5段階(1〜5)
  rating: number | null;
  estimated_duration_seconds: number | null;
  duration_pending: ColumnType<SqliteBoolean, SqliteBoolean | undefined, SqliteBoolean>;
  raw_duration_value: string | null;
  raw_duration_unit: string | null;
  added_at: UnixSeconds;
  completed_at: UnixSeconds | null;
  created_at: UnixSeconds;
  updated_at: UnixSeconds;
}

export interface FollowTable {
  follower_id: string;
  followee_id: string;
  created_at: UnixSeconds;
}

export interface BlockTable {
  blocker_id: string;
  blocked_id: string;
  created_at: UnixSeconds;
}

export type ReportTargetType = "profile" | "entry";
export type ReportStatus = "pending" | "resolved";

export interface ReportTable {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: string;
  status: ColumnType<ReportStatus, ReportStatus | undefined, ReportStatus>;
  reported_at: UnixSeconds;
  resolved_at: UnixSeconds | null;
}

export type RecapPeriodType = "weekly" | "monthly";

export interface RecapTable {
  user_id: string;
  period_type: RecapPeriodType;
  period_start: UnixSeconds;
  period_end: UnixSeconds;
  // IDと算出済み数値のみ。タイトル・画像URLは焼き込まない(セクション5参照)
  payload: string;
  payload_version: number;
  generated_at: UnixSeconds;
}

export interface DeletionLogTable {
  id: string;
  source: string;
  source_id: string;
  reason: string;
  reference: string | null;
  deleted_at: UnixSeconds;
}

export interface Database {
  user: UserTable;
  session: SessionTable;
  account: AccountTable;
  verification: VerificationTable;
  catalog_entities: CatalogEntityTable;
  source_records: SourceRecordTable;
  shelf_entries: ShelfEntryTable;
  follows: FollowTable;
  blocks: BlockTable;
  reports: ReportTable;
  recaps: RecapTable;
  deletion_log: DeletionLogTable;
}

// idカラムは呼び出し側でUUIDv7を生成して渡す前提のため、Generated<>は使わない
export type { Generated };
