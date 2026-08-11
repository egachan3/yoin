// catalog_entities/source_recordsへの正規化保存ロジック。
// 参照: shelf-type-app-spec.md セクション5「catalog_entitiesと正規化レイヤーの関係」

import { uuidv7 } from "uuidv7";
import type { Kysely } from "kysely";
import type { Database, CatalogSource } from "./schema";
import type { NdlBookCandidate } from "@/lib/sources/ndl";
import { fetchCoverByIsbn } from "@/lib/sources/google-books";
import type { MusicCandidate } from "@/lib/sources/musicbrainz";
import { fetchCoverArtByRelease, fetchCoverArtByReleaseGroup } from "@/lib/sources/musicbrainz";
import type { ItunesCandidate } from "@/lib/sources/itunes";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function findExistingCatalogId(db: Kysely<Database>, ndlBibId: string): Promise<string | null> {
  const existing = await db
    .selectFrom("source_records")
    .select("catalog_entity_id")
    .where("source", "=", "ndl")
    .where("source_id", "=", ndlBibId)
    .executeTakeFirst();
  return existing?.catalog_entity_id ?? null;
}

/**
 * NDLの書籍候補をcatalog_entities/source_recordsに正規化して保存する。
 * 既に同じNDL書誌IDのsource_recordsがあれば、新規作成せず既存のcatalog_entity_idを返す
 * (複数ユーザーが同じ本を追加しても1つのcatalog_entitiesに束ねる、が正規化レイヤーの本旨)。
 *
 * 書影(Google Books)は今回は簡易実装として、primary_image_refに取得したURLを
 * そのまま保存する(本来はセクション5のR2永続保存+遅延補充の仕組みでwork_id経由の
 * 参照にする設計だが、そのインフラは別途まとめて実装する方針のため後回し)。
 */
export async function findOrCreateBookCatalogEntity(
  db: Kysely<Database>,
  d1: D1Database,
  candidate: NdlBookCandidate,
  googleBooksApiKey?: string,
): Promise<string> {
  const existingId = await findExistingCatalogId(db, candidate.ndlBibId);
  if (existingId) {
    return existingId;
  }

  const catalogId = uuidv7();
  const now = nowSeconds();

  // catalog_entities + source_records(ndl)の作成はD1のネイティブbatch()で
  // 原子的に実行する(全部成功 or 全部失敗)。KyselyのdbTransaction()相当は
  // kysely-d1では実際には何もしないスタブ(D1自体がインタラクティブな
  // トランザクションを持たないため)であることをコードレビューで確認済み。
  // compile()でSQL+パラメータに変換し、D1本来のprepare().bind()に渡す。
  const insertCatalogEntity = db
    .insertInto("catalog_entities")
    .values({
      id: catalogId,
      genre: "book",
      title: candidate.title,
      primary_image_ref: null,
      owner_user_id: null,
      merged_into_id: null,
      created_at: now,
      updated_at: now,
    })
    .compile();

  const insertSourceRecord = db
    .insertInto("source_records")
    .values({
      id: uuidv7(),
      catalog_entity_id: catalogId,
      source: "ndl",
      source_id: candidate.ndlBibId,
      source_url: `https://ndlsearch.ndl.go.jp/books/${candidate.ndlBibId}`,
      raw_fields: JSON.stringify({
        title: candidate.title,
        creator: candidate.creator,
        publisher: candidate.publisher,
        isbn: candidate.isbn,
        extent: candidate.extentRaw,
      }),
      deletion_status: "active",
      cached_at: null,
      created_at: now,
      updated_at: now,
    })
    .compile();

  try {
    await d1.batch([
      d1.prepare(insertCatalogEntity.sql).bind(...insertCatalogEntity.parameters),
      d1.prepare(insertSourceRecord.sql).bind(...insertSourceRecord.parameters),
    ]);
  } catch (err) {
    // UNIQUE(source, source_id)違反 = 他ユーザーがほぼ同時に同じ本を初めて
    // 追加した(レース条件)。孤児のcatalog_entities行を残さないよう、
    // 勝者側が作成した既存行を再取得して返す
    if (err instanceof Error && /UNIQUE constraint failed:.*source_records/i.test(err.message)) {
      const raceWinnerId = await findExistingCatalogId(db, candidate.ndlBibId);
      if (raceWinnerId) {
        return raceWinnerId;
      }
    }
    throw err;
  }

  // 書影取得はここから先。ISBNがない書籍(古い本・同人誌等)は取得自体を
  // 諦める(セクション5.4の決定通り)。失敗しても上記の原子的な書き込みは
  // 既に成功済みなので、primary_image_refがnullのまま残るだけで許容する
  if (candidate.isbn) {
    let coverImageUrl: string | null = null;
    try {
      const imageLinks = await fetchCoverByIsbn(candidate.isbn, googleBooksApiKey);
      coverImageUrl = imageLinks?.thumbnail ?? null;
    } catch {
      // ネットワークエラー・タイムアウト等。書影取得自体を諦める
      coverImageUrl = null;
    }

    if (coverImageUrl) {
      // primary_image_refのUPDATEとsource_records(google_books)のINSERTも
      // batch()で原子的に実行する。同じISBNの書影が別のcatalog_entity経由で
      // 既に登録済み(別版・重複カタログ化等)だとINSERT側がUNIQUE違反になるが、
      // batch()なら一緒にUPDATEもロールバックされるため、「primary_image_refは
      // 設定されているのに対応するsource_recordsがない」という宙に浮いた状態が
      // 起こり得ない(レビュー指摘)
      const updateCatalog = db
        .updateTable("catalog_entities")
        .set({ primary_image_ref: coverImageUrl, updated_at: nowSeconds() })
        .where("id", "=", catalogId)
        .compile();

      const insertGoogleBooksRecord = db
        .insertInto("source_records")
        .values({
          id: uuidv7(),
          catalog_entity_id: catalogId,
          source: "google_books",
          source_id: candidate.isbn,
          source_url: null,
          // imageLinksのみ(google-books.tsの型自体がtitle/description等を持てない設計)
          raw_fields: JSON.stringify({ thumbnail: coverImageUrl }),
          deletion_status: "active",
          cached_at: null,
          created_at: nowSeconds(),
          updated_at: nowSeconds(),
        })
        .compile();

      try {
        await d1.batch([
          d1.prepare(updateCatalog.sql).bind(...updateCatalog.parameters),
          d1.prepare(insertGoogleBooksRecord.sql).bind(...insertGoogleBooksRecord.parameters),
        ]);
      } catch (err) {
        // UNIQUE(source, source_id)違反(=既に別経由で登録済み)は想定内なので
        // 無言で許容する。それ以外の想定外エラーは、書誌情報の登録自体は
        // 既に成功済みなので処理は継続する(書影は無くてもUI上はプレースホルダ
        // で表示される)が、原因調査ができるようログにだけ残す
        // (レビュー指摘: 以前はここが両者を区別しない空のif分岐になっていた)
        const isKnownConflict = err instanceof Error && /UNIQUE constraint failed:.*source_records/i.test(err.message);
        if (!isKnownConflict) {
          console.error("[findOrCreateBookCatalogEntity] 書影の登録に失敗しました", err);
        }
      }
    }
  }

  return catalogId;
}

export type MusicSourceCandidate = MusicCandidate | ItunesCandidate;

async function findExistingMusicCatalogId(
  db: Kysely<Database>,
  source: CatalogSource,
  sourceId: string,
): Promise<string | null> {
  const existing = await db
    .selectFrom("source_records")
    .select("catalog_entity_id")
    .where("source", "=", source)
    .where("source_id", "=", sourceId)
    .executeTakeFirst();
  return existing?.catalog_entity_id ?? null;
}

/**
 * 音楽(曲/アルバム)候補をcatalog_entities/source_recordsに正規化して保存する。
 * 骨格はfindOrCreateBookCatalogEntityと同じだが、書籍と違い候補のsourceが
 * "musicbrainz"/"itunes"のどちらもあり得るため、既存チェック・source_records
 * のsource値をcandidate.sourceで分岐する。
 *
 * ジャケット画像はMusicBrainz経由のみ取得する(iTunesのアートワークは
 * Promo Content規約上使用しないと決定済み。セクション3.2参照)。
 */
export async function findOrCreateMusicCatalogEntity(
  db: Kysely<Database>,
  d1: D1Database,
  candidate: MusicSourceCandidate,
): Promise<string> {
  const existingId = await findExistingMusicCatalogId(db, candidate.source, candidate.sourceId);
  if (existingId) {
    return existingId;
  }

  const catalogId = uuidv7();
  const now = nowSeconds();

  const insertCatalogEntity = db
    .insertInto("catalog_entities")
    .values({
      id: catalogId,
      genre: "music",
      title: candidate.title,
      primary_image_ref: null,
      owner_user_id: null,
      merged_into_id: null,
      created_at: now,
      updated_at: now,
    })
    .compile();

  const insertSourceRecord = db
    .insertInto("source_records")
    .values({
      id: uuidv7(),
      catalog_entity_id: catalogId,
      source: candidate.source,
      source_id: candidate.sourceId,
      source_url: null,
      raw_fields: JSON.stringify({
        title: candidate.title,
        artist: candidate.artist,
        entityType: candidate.entityType,
        lengthMs: candidate.lengthMs,
      }),
      deletion_status: "active",
      cached_at: null,
      created_at: now,
      updated_at: now,
    })
    .compile();

  try {
    await d1.batch([
      d1.prepare(insertCatalogEntity.sql).bind(...insertCatalogEntity.parameters),
      d1.prepare(insertSourceRecord.sql).bind(...insertSourceRecord.parameters),
    ]);
  } catch (err) {
    // UNIQUE(source, source_id)違反 = レース条件(findOrCreateBookCatalogEntityと同じ扱い)
    if (err instanceof Error && /UNIQUE constraint failed:.*source_records/i.test(err.message)) {
      const raceWinnerId = await findExistingMusicCatalogId(db, candidate.source, candidate.sourceId);
      if (raceWinnerId) {
        return raceWinnerId;
      }
    }
    throw err;
  }

  // ジャケット画像はMusicBrainz由来の候補のみ取得を試みる
  if (candidate.source === "musicbrainz") {
    let coverImageUrl: string | null = null;
    let coverArtReleaseId: string | null = null;
    try {
      if (candidate.entityType === "release-group") {
        coverImageUrl = await fetchCoverArtByReleaseGroup(candidate.sourceId);
        coverArtReleaseId = candidate.sourceId;
      } else if (candidate.releaseIdForCoverArt) {
        coverImageUrl = await fetchCoverArtByRelease(candidate.releaseIdForCoverArt);
        coverArtReleaseId = candidate.releaseIdForCoverArt;
      }
    } catch {
      coverImageUrl = null;
    }

    if (coverImageUrl && coverArtReleaseId) {
      const updateCatalog = db
        .updateTable("catalog_entities")
        .set({ primary_image_ref: coverImageUrl, updated_at: nowSeconds() })
        .where("id", "=", catalogId)
        .compile();

      // 同じMusicBrainz release(アルバム)には複数のcatalog_entity(収録曲ごと)が
      // 紐づき得るため、source_records(source="cover_art_archive")のsource_idは
      // catalog_entity間で重複しうる(UNIQUE(source, source_id)はndl/musicbrainz/itunes
      // のような1エンティティ=1レコードの主識別子を想定した制約で、cover_art_archiveの
      // ような複数エンティティ間で共有され得る派生レコードとは前提が異なる。レビュー指摘)。
      // 既に同じsource_idのレコードがあればINSERTをスキップし、UPDATEのみ行う
      const existingCoverRecord = await db
        .selectFrom("source_records")
        .select("id")
        .where("source", "=", "cover_art_archive")
        .where("source_id", "=", coverArtReleaseId)
        .executeTakeFirst();

      if (existingCoverRecord) {
        try {
          await d1.prepare(updateCatalog.sql).bind(...updateCatalog.parameters).run();
        } catch (err) {
          console.error("[findOrCreateMusicCatalogEntity] ジャケット画像の登録に失敗しました", err);
        }
      } else {
        const insertCoverArtRecord = db
          .insertInto("source_records")
          .values({
            id: uuidv7(),
            catalog_entity_id: catalogId,
            source: "cover_art_archive",
            source_id: coverArtReleaseId,
            source_url: null,
            raw_fields: JSON.stringify({ front: coverImageUrl }),
            deletion_status: "active",
            cached_at: null,
            created_at: nowSeconds(),
            updated_at: nowSeconds(),
          })
          .compile();

        try {
          await d1.batch([
            d1.prepare(updateCatalog.sql).bind(...updateCatalog.parameters),
            d1.prepare(insertCoverArtRecord.sql).bind(...insertCoverArtRecord.parameters),
          ]);
        } catch (err) {
          const isKnownConflict = err instanceof Error && /UNIQUE constraint failed:.*source_records/i.test(err.message);
          if (isKnownConflict) {
            // 上の存在チェックと本INSERTの間に、別リクエストが同じsource_idを
            // 先に登録した(レース条件)。このcatalog_entity自身のジャケット表示は
            // 諦めずUPDATEだけでも反映する
            try {
              await d1.prepare(updateCatalog.sql).bind(...updateCatalog.parameters).run();
            } catch (updateErr) {
              console.error("[findOrCreateMusicCatalogEntity] ジャケット画像の登録に失敗しました", updateErr);
            }
          } else {
            console.error("[findOrCreateMusicCatalogEntity] ジャケット画像の登録に失敗しました", err);
          }
        }
      }
    }
  }

  return catalogId;
}
