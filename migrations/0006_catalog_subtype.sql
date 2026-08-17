-- 棚をカテゴリ別の2階層(カテゴリカード → 詳細一覧)に作り替えるにあたり、
-- 表示用の分類軸としてcatalog_entities.subtypeを導入する。
-- 参照: 引き継ぎ.md 3.5節「UI全面刷新の仕様」
--
-- 【なぜsource_recordsからの都度導出ではなくカラムを足すのか】
-- 映画/ドラマとアニメ/マンガはsource_records.source_idの'movie:'/'tv:'/'anime:'/'manga:'
-- プレフィックスから、アルバム/曲はraw_fieldsのJSON内entityTypeから導出できる。
-- しかしそれらは「外部APIへ再照会するためのヒント」として設計された場所であり、
-- 表示のために内部の保存形式へ依存するのは筋が悪い。加えて手動入力エントリは
-- source_records自体を持たない(src/app/api/shelf/manual/route.ts)ため、
-- 都度導出では永久に分類できない。

-- 開発中のため既存データは作り直す方針(ユーザー合意済み)。
-- 子テーブルから先に消してFK違反を避ける。userテーブルには触れない
-- (アカウントとハンドルは残すため、ログインし直しは不要)。
DELETE FROM shelf_entries;
DELETE FROM source_records;
DELETE FROM catalog_entities;

-- 【なぜNOT NULLにしないのか】
-- SQLiteは「NOT NULL列を後から追加するときデフォルト値が必須」という制約を持つ。
-- ここで'book'等の意味のないデフォルトを置くと、将来subtypeを渡し忘れたコードが
-- 黙って「本」として保存されるという、気づきにくい事故の温床になる。
-- 値の必須性はTypeScript側(CatalogEntityTable.subtype: Subtype)で担保し、
-- 渡し忘れはビルド時に止める。
-- 取りうる値: 'book' | 'album' | 'song' | 'movie' | 'tv' | 'anime' | 'manga' | 'game'
ALTER TABLE catalog_entities ADD COLUMN subtype TEXT;

-- 棚トップは「カテゴリごとの件数と代表画像」を出すため、subtype単位の絞り込みが
-- 全画面の起点になる。ジャンル横断で1ユーザー分を引く既存クエリと併せて効くよう、
-- catalog_entities側に索引を張る。
CREATE INDEX idx_catalog_entities_subtype ON catalog_entities(subtype);
