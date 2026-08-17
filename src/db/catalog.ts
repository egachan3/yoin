// catalog_entities/source_recordsへの正規化保存ロジック。
// 参照: shelf-type-app-spec.md セクション5「catalog_entitiesと正規化レイヤーの関係」

import { uuidv7 } from "uuidv7";
import type { Kysely, Insertable } from "kysely";
import type { Database, CatalogSource, ShelfEntryTable, Subtype } from "./schema";
import { SUBTYPE_TO_GENRE } from "@/lib/categories";
import type { NdlBookCandidate } from "@/lib/sources/ndl";
import { fetchCoverByIsbn } from "@/lib/sources/google-books";
import type { MusicCandidate } from "@/lib/sources/musicbrainz";
import { fetchCoverArtByRelease, fetchCoverArtByReleaseGroup } from "@/lib/sources/musicbrainz";
import type { ItunesCandidate } from "@/lib/sources/itunes";
import type { TmdbCandidate } from "@/lib/sources/tmdb";
import { buildImageUrl } from "@/lib/sources/tmdb";
import type { MalCandidate } from "@/lib/sources/mal";
import {
  buildSourceId as buildMalSourceId,
  buildSourceUrl as buildMalSourceUrl,
  displayTitle as malDisplayTitle,
  buildRawFields as buildMalRawFields,
} from "@/lib/sources/mal";
import type { IgdbCandidate } from "@/lib/sources/igdb";
import {
  buildImageUrl as buildIgdbImageUrl,
  buildRawFields as buildIgdbRawFields,
  buildSourceUrl as buildIgdbSourceUrl,
  displayTitle as igdbDisplayTitle,
} from "@/lib/sources/igdb";
import { MANUAL_PLACEHOLDER_IMAGE } from "@/lib/manual-entry";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * shelf_entriesの挿入値。catalog_idだけは呼び出し元(API route)が知らない
 * (findOrCreate*が新規作成するかどうかで決まるため)ので除外している。
 *
 * 【原子化の設計】以前はfindOrCreate*CatalogEntity → 呼び出し側で別途
 * shelf_entries INSERT、という2段階になっており、後者が失敗すると
 * どのshelf_entriesからも参照されない孤立したcatalog_entities行が残った
 * (レビュー指摘、全ジャンル共通)。catalog_entityを新規作成する場合は
 * shelf_entriesの挿入もd1.batch()に含めて原子化する。既存catalog_entityを
 * 再利用する場合は、shelf_entries挿入は単文のみなので原子性の懸念自体が生じない。
 */
export type ShelfEntryValuesWithoutCatalogId = Omit<Insertable<ShelfEntryTable>, "catalog_id">;

function compileShelfEntryInsert(
  db: Kysely<Database>,
  catalogId: string,
  values: ShelfEntryValuesWithoutCatalogId,
) {
  return db
    .insertInto("shelf_entries")
    .values({ ...values, catalog_id: catalogId })
    .compile();
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
  shelfEntryValues: ShelfEntryValuesWithoutCatalogId,
  googleBooksApiKey?: string,
): Promise<string> {
  const existingId = await findExistingCatalogId(db, candidate.ndlBibId);
  if (existingId) {
    // 既存カタログを再利用する場合、shelf_entriesの挿入は単文のみなので
    // そのまま原子的(バッチにする必要がない)
    await db
      .insertInto("shelf_entries")
      .values({ ...shelfEntryValues, catalog_id: existingId })
      .execute();
    return existingId;
  }

  const catalogId = uuidv7();
  const now = nowSeconds();

  // catalog_entities + source_records(ndl) + shelf_entriesの作成はD1のネイティブ
  // batch()で原子的に実行する(全部成功 or 全部失敗)。KyselyのdbTransaction()相当は
  // kysely-d1では実際には何もしないスタブ(D1自体がインタラクティブな
  // トランザクションを持たないため)であることをコードレビューで確認済み。
  // compile()でSQL+パラメータに変換し、D1本来のprepare().bind()に渡す。
  const insertCatalogEntity = db
    .insertInto("catalog_entities")
    .values({
      id: catalogId,
      genre: "book",
      subtype: "book",
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

  const insertShelfEntry = compileShelfEntryInsert(db, catalogId, shelfEntryValues);

  try {
    await d1.batch([
      d1.prepare(insertCatalogEntity.sql).bind(...insertCatalogEntity.parameters),
      d1.prepare(insertSourceRecord.sql).bind(...insertSourceRecord.parameters),
      d1.prepare(insertShelfEntry.sql).bind(...insertShelfEntry.parameters),
    ]);
  } catch (err) {
    // UNIQUE(source, source_id)違反 = 他ユーザーがほぼ同時に同じ本を初めて
    // 追加した(レース条件)。孤児のcatalog_entities行を残さないよう、
    // 勝者側が作成した既存行を再取得し、今回のshelf_entryだけ単独で追加する
    if (err instanceof Error && /UNIQUE constraint failed:.*source_records/i.test(err.message)) {
      const raceWinnerId = await findExistingCatalogId(db, candidate.ndlBibId);
      if (raceWinnerId) {
        await db
          .insertInto("shelf_entries")
          .values({ ...shelfEntryValues, catalog_id: raceWinnerId })
          .execute();
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

/**
 * 音楽候補の「アルバムか曲か」をsubtypeに正規化する。
 * MusicBrainzは release-group / recording、iTunesは album / song と
 * 語彙が異なるため、ここで1つに寄せる。
 *
 * 網羅的なマップにしているのは、将来どちらかのAPIに新しいentityTypeが増えたとき、
 * elseへのフォールバックで黙って「曲」として保存されるのを防ぐため
 * (キーが欠けるとRecordの型でビルドが落ちる)。
 */
const MUSIC_SUBTYPE: Record<MusicSourceCandidate["entityType"], Subtype> = {
  "release-group": "album",
  album: "album",
  recording: "song",
  song: "song",
};

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
  shelfEntryValues: ShelfEntryValuesWithoutCatalogId,
): Promise<string> {
  const existingId = await findExistingMusicCatalogId(db, candidate.source, candidate.sourceId);
  if (existingId) {
    await db
      .insertInto("shelf_entries")
      .values({ ...shelfEntryValues, catalog_id: existingId })
      .execute();
    return existingId;
  }

  const catalogId = uuidv7();
  const now = nowSeconds();

  const insertCatalogEntity = db
    .insertInto("catalog_entities")
    .values({
      id: catalogId,
      genre: "music",
      subtype: MUSIC_SUBTYPE[candidate.entityType],
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

  const insertShelfEntry = compileShelfEntryInsert(db, catalogId, shelfEntryValues);

  try {
    await d1.batch([
      d1.prepare(insertCatalogEntity.sql).bind(...insertCatalogEntity.parameters),
      d1.prepare(insertSourceRecord.sql).bind(...insertSourceRecord.parameters),
      d1.prepare(insertShelfEntry.sql).bind(...insertShelfEntry.parameters),
    ]);
  } catch (err) {
    // UNIQUE(source, source_id)違反 = レース条件(findOrCreateBookCatalogEntityと同じ扱い)
    if (err instanceof Error && /UNIQUE constraint failed:.*source_records/i.test(err.message)) {
      const raceWinnerId = await findExistingMusicCatalogId(db, candidate.source, candidate.sourceId);
      if (raceWinnerId) {
        await db
          .insertInto("shelf_entries")
          .values({ ...shelfEntryValues, catalog_id: raceWinnerId })
          .execute();
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

async function findExistingMovieCatalogId(db: Kysely<Database>, sourceId: string): Promise<string | null> {
  const existing = await db
    .selectFrom("source_records")
    .select("catalog_entity_id")
    .where("source", "=", "tmdb")
    .where("source_id", "=", sourceId)
    .executeTakeFirst();
  return existing?.catalog_entity_id ?? null;
}

/**
 * 映画・ドラマ候補をcatalog_entities/source_recordsに正規化して保存する。
 * 骨格は書籍/音楽と同じだが、画像もTMDB自身が返すため(音楽のCover Art
 * Archiveのような別ソース呼び出しは不要)、1回のbatch()で完結する。
 *
 * source_idは`${mediaType}:${tmdbId}`形式にする。TMDBの映画IDとTV番組IDは
 * 別の採番空間で同じ数値が別作品を指しうるため、mediaTypeを含めないと
 * source_records.UNIQUE(source, source_id)で異なる作品が衝突する。
 */
export async function findOrCreateMovieCatalogEntity(
  db: Kysely<Database>,
  d1: D1Database,
  candidate: TmdbCandidate,
  shelfEntryValues: ShelfEntryValuesWithoutCatalogId,
): Promise<string> {
  const sourceId = `${candidate.mediaType}:${candidate.tmdbId}`;
  const existingId = await findExistingMovieCatalogId(db, sourceId);
  if (existingId) {
    await db
      .insertInto("shelf_entries")
      .values({ ...shelfEntryValues, catalog_id: existingId })
      .execute();
    return existingId;
  }

  const catalogId = uuidv7();
  const now = nowSeconds();
  const imageUrl = candidate.posterPath ? buildImageUrl(candidate.posterPath) : null;

  const insertCatalogEntity = db
    .insertInto("catalog_entities")
    .values({
      id: catalogId,
      genre: "movie_tv",
      // TMDBのmediaType("movie"/"tv")がそのままsubtypeの語彙になっている
      subtype: candidate.mediaType,
      title: candidate.title,
      primary_image_ref: imageUrl,
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
      source: "tmdb",
      source_id: sourceId,
      // TMDBは正規URLを機械的に組み立てられる。来歴追跡・削除要請時の突き合わせに
      // 使えるよう保存しておく(レビュー指摘)
      source_url: `https://www.themoviedb.org/${candidate.mediaType}/${candidate.tmdbId}`,
      raw_fields: JSON.stringify({
        title: candidate.title,
        mediaType: candidate.mediaType,
        releaseDate: candidate.releaseDate,
        runtimeMinutes: candidate.runtimeMinutes,
        episodeRuntimeMinutes: candidate.episodeRuntimeMinutes,
        numberOfEpisodes: candidate.numberOfEpisodes,
      }),
      deletion_status: "active",
      // TMDBは「6ヶ月を超える情報キャッシュ禁止」の対象のため、再取得基準として
      // 書き込み時刻を記録しておく。定期再取得・削除ジョブ自体は今回のスコープ外
      // (画像プロキシ実装時に他ジャンルと合わせて一括対応する方針。ユーザー合意済み)
      cached_at: now,
      created_at: now,
      updated_at: now,
    })
    .compile();

  const insertShelfEntry = compileShelfEntryInsert(db, catalogId, shelfEntryValues);

  try {
    await d1.batch([
      d1.prepare(insertCatalogEntity.sql).bind(...insertCatalogEntity.parameters),
      d1.prepare(insertSourceRecord.sql).bind(...insertSourceRecord.parameters),
      d1.prepare(insertShelfEntry.sql).bind(...insertShelfEntry.parameters),
    ]);
  } catch (err) {
    // UNIQUE(source, source_id)違反 = レース条件(書籍/音楽と同じ扱い)
    if (err instanceof Error && /UNIQUE constraint failed:.*source_records/i.test(err.message)) {
      const raceWinnerId = await findExistingMovieCatalogId(db, sourceId);
      if (raceWinnerId) {
        await db
          .insertInto("shelf_entries")
          .values({ ...shelfEntryValues, catalog_id: raceWinnerId })
          .execute();
        return raceWinnerId;
      }
    }
    throw err;
  }

  return catalogId;
}

async function findExistingAnimeMangaCatalogId(db: Kysely<Database>, sourceId: string): Promise<string | null> {
  const existing = await db
    .selectFrom("source_records")
    .select("catalog_entity_id")
    .where("source", "=", "mal")
    .where("source_id", "=", sourceId)
    .executeTakeFirst();
  return existing?.catalog_entity_id ?? null;
}

/**
 * アニメ・マンガ候補をcatalog_entities/source_recordsに正規化して保存する。
 * 構造は映画・ドラマ(TMDB)と同じ。画像もMAL自身がURLを返すため1回のbatch()で完結する。
 *
 * source_idは`${mediaType}:${malId}`形式(MALのアニメIDとマンガIDは別の採番空間の
 * ため。詳細はmal.tsのbuildSourceId参照)。
 *
 * 【重要】raw_fieldsに書き込むのは「事実」フィールドのみ(spec 3.4)。
 * synopsis/mean/rank/popularityはMALユーザーの生成物の集約であり、API Agreement
 * Section 3(c)のサーバー側保存禁止に該当し得るため保存しない。MalCandidate型が
 * そもそもそれらを持たない設計なので、ここで書き込むことは構造的にできない。
 */
export async function findOrCreateAnimeMangaCatalogEntity(
  db: Kysely<Database>,
  d1: D1Database,
  candidate: MalCandidate,
  shelfEntryValues: ShelfEntryValuesWithoutCatalogId,
): Promise<string> {
  const sourceId = buildMalSourceId(candidate);
  const existingId = await findExistingAnimeMangaCatalogId(db, sourceId);
  if (existingId) {
    await db
      .insertInto("shelf_entries")
      .values({ ...shelfEntryValues, catalog_id: existingId })
      .execute();
    return existingId;
  }

  const catalogId = uuidv7();
  const now = nowSeconds();

  const insertCatalogEntity = db
    .insertInto("catalog_entities")
    .values({
      id: catalogId,
      genre: "anime_manga",
      // MALのmediaType("anime"/"manga")がそのままsubtypeの語彙になっている
      subtype: candidate.mediaType,
      // 日本語タイトルがあれば優先する(spec 6章の日本市場向け差別化)
      title: malDisplayTitle(candidate),
      primary_image_ref: candidate.mainPicture,
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
      source: "mal",
      source_id: sourceId,
      // Section 3(e)の24時間削除義務・Section 18の監査権に備え、来歴URLを残す
      source_url: buildMalSourceUrl(candidate),
      // 保存するフィールドの選定はmal.ts側のホワイトリストに集約している
      // (spec 5.4「強制手段はコードレビュー運用に頼らない」。テストで守る)
      raw_fields: JSON.stringify(buildMalRawFields(candidate)),
      deletion_status: "active",
      // MALには6ヶ月キャッシュ上限のような明示的な期限はないが、Section 3(e)の
      // 削除要請対応・Section 6の負荷配慮のため再取得基準として記録しておく
      // (定期再取得ジョブ自体はTMDBと合わせて画像プロキシ実装時に一括対応)
      cached_at: now,
      created_at: now,
      updated_at: now,
    })
    .compile();

  const insertShelfEntry = compileShelfEntryInsert(db, catalogId, shelfEntryValues);

  try {
    await d1.batch([
      d1.prepare(insertCatalogEntity.sql).bind(...insertCatalogEntity.parameters),
      d1.prepare(insertSourceRecord.sql).bind(...insertSourceRecord.parameters),
      d1.prepare(insertShelfEntry.sql).bind(...insertShelfEntry.parameters),
    ]);
  } catch (err) {
    // UNIQUE(source, source_id)違反 = レース条件(書籍/音楽/映画と同じ扱い)
    if (err instanceof Error && /UNIQUE constraint failed:.*source_records/i.test(err.message)) {
      const raceWinnerId = await findExistingAnimeMangaCatalogId(db, sourceId);
      if (raceWinnerId) {
        await db
          .insertInto("shelf_entries")
          .values({ ...shelfEntryValues, catalog_id: raceWinnerId })
          .execute();
        return raceWinnerId;
      }
    }
    throw err;
  }

  return catalogId;
}

async function findExistingGameCatalogId(db: Kysely<Database>, sourceId: string): Promise<string | null> {
  const existing = await db
    .selectFrom("source_records")
    .select("catalog_entity_id")
    .where("source", "=", "igdb")
    .where("source_id", "=", sourceId)
    .executeTakeFirst();
  return existing?.catalog_entity_id ?? null;
}

/**
 * ゲーム候補をcatalog_entities/source_recordsに正規化して保存する。
 * 構造は映画・ドラマ(TMDB)/アニメ・マンガ(MAL)と同じ。画像もIGDB自身が
 * image_idを返すため(音楽のCover Art Archiveのような別ソース呼び出しは不要)、
 * 1回のbatch()で完結する。
 *
 * IGDBのゲームIDは単一の採番空間(映画・ドラマのmovie/tv、アニメ・マンガの
 * anime/mangaのような複数種別の混在がない)ため、source_idはigdbIdをそのまま
 * 文字列化するだけでよい(プレフィックス不要)。
 */
export async function findOrCreateGameCatalogEntity(
  db: Kysely<Database>,
  d1: D1Database,
  candidate: IgdbCandidate,
  shelfEntryValues: ShelfEntryValuesWithoutCatalogId,
): Promise<string> {
  const sourceId = String(candidate.igdbId);
  const existingId = await findExistingGameCatalogId(db, sourceId);
  if (existingId) {
    await db
      .insertInto("shelf_entries")
      .values({ ...shelfEntryValues, catalog_id: existingId })
      .execute();
    return existingId;
  }

  const catalogId = uuidv7();
  const now = nowSeconds();
  const imageUrl = candidate.coverImageId ? buildIgdbImageUrl(candidate.coverImageId) : null;

  const insertCatalogEntity = db
    .insertInto("catalog_entities")
    .values({
      id: catalogId,
      genre: "game",
      subtype: "game",
      // 日本語タイトルがあれば優先する(spec 6章の日本市場向け差別化。アニメ・マンガと同じ)
      title: igdbDisplayTitle(candidate),
      primary_image_ref: imageUrl,
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
      source: "igdb",
      source_id: sourceId,
      source_url: buildIgdbSourceUrl(candidate),
      // 保存するフィールドの選定はigdb.ts側のホワイトリストに集約している
      // (spec 5.4「強制手段はコードレビュー運用に頼らない」。テストで守る)
      raw_fields: JSON.stringify(buildIgdbRawFields(candidate)),
      deletion_status: "active",
      // IGDBの画像は削除・差し替えから30日で消える(公式ドキュメント記載、
      // TMDBの6ヶ月より短いサイクル)。再取得基準として記録しておく
      // (定期再取得ジョブ自体は他ジャンルと合わせて画像プロキシ実装時に一括対応)
      cached_at: now,
      created_at: now,
      updated_at: now,
    })
    .compile();

  const insertShelfEntry = compileShelfEntryInsert(db, catalogId, shelfEntryValues);

  try {
    await d1.batch([
      d1.prepare(insertCatalogEntity.sql).bind(...insertCatalogEntity.parameters),
      d1.prepare(insertSourceRecord.sql).bind(...insertSourceRecord.parameters),
      d1.prepare(insertShelfEntry.sql).bind(...insertShelfEntry.parameters),
    ]);
  } catch (err) {
    // UNIQUE(source, source_id)違反 = レース条件(他ジャンルと同じ扱い)
    if (err instanceof Error && /UNIQUE constraint failed:.*source_records/i.test(err.message)) {
      const raceWinnerId = await findExistingGameCatalogId(db, sourceId);
      if (raceWinnerId) {
        await db
          .insertInto("shelf_entries")
          .values({ ...shelfEntryValues, catalog_id: raceWinnerId })
          .execute();
        return raceWinnerId;
      }
    }
    throw err;
  }

  return catalogId;
}

export interface ManualCatalogEntityInput {
  // 手動入力に至る導線は必ず特定のカテゴリの検索画面を経由するため、
  // subtypeは呼び出し時点で確定している(ユーザーに再度選ばせる必要はない)。
  // genreはSUBTYPE_TO_GENREで導出し、二重指定による食い違いを防ぐ
  subtype: Subtype;
  title: string;
  ownerUserId: string;
}

/**
 * 手動入力エントリのユーザーアップロード画像。R2への書き込みはcatalog_entity
 * 作成後のフォローアップ扱い(書籍のGoogle Books書影取得と同じ考え方: 失敗しても
 * catalog_entities+shelf_entriesの原子的な書き込み自体は既に成功済みなので、
 * プレースホルダーのまま残るだけで許容する)。
 */
export interface ManualImageUpload {
  r2: R2Bucket;
  bytes: ArrayBuffer;
  contentType: string;
}

/**
 * 外部APIで検索してもヒットしない作品を、ユーザー自身の手で棚に記録するための
 * catalog_entity作成関数(spec 5.4「検索結果0件時のフォールバックUI」)。
 *
 * 上記の findOrCreate*CatalogEntity 群とは性質が正反対のため、共通化せず別関数にしている:
 * - findOrCreate*: 外部ソースIDを正規化キーに、同じ作品なら複数ユーザー・複数回の
 *   追加を1つのcatalog_entityに名寄せする(source_recordsのUNIQUE制約が前提)
 * - createManualCatalogEntity: 自由記述タイトルには正規化キーが存在しない
 *   (「鬼滅の刃」を2人が手動入力しても別作品かもしれない)。したがって常に新規行を作り、
 *   owner_user_idで所有者に紐付けて他ユーザーの名寄せ対象・検索結果から構造的に除外する
 *
 * source_recordsは一切作らない(手動入力には外部ソースが存在しないため)。
 * 画像はユーザーが任意でアップロードでき(imageUpload省略時はジャンル別の静的
 * プレースホルダーのまま)、`/api/entries/{catalogId}/image`という認証付きルート
 * (所有者本人のみ閲覧可)経由で配信する。手動入力エントリは本人以外に表示されない
 * 設計のため、R2画像プロキシ(/img/[workId]/[variant]、認証なし・全公開)とは
 * 意図的に別の配信経路にしている(image-proxy.tsのresolveImageSourceが
 * owner_user_id非nullの行を構造的に除外している設計と対になる)。
 */
export async function createManualCatalogEntity(
  db: Kysely<Database>,
  d1: D1Database,
  input: ManualCatalogEntityInput,
  shelfEntryValues: ShelfEntryValuesWithoutCatalogId,
  imageUpload?: ManualImageUpload,
): Promise<string> {
  const catalogId = uuidv7();
  const now = nowSeconds();

  // 手動入力は常に新規作成なので、findOrCreate*系のような既存行再利用・
  // レース条件処理は不要。catalog_entities + shelf_entriesの2文を
  // d1.batch()で原子的に実行するだけでよい
  const insertCatalogEntity = db
    .insertInto("catalog_entities")
    .values({
      id: catalogId,
      genre: SUBTYPE_TO_GENRE[input.subtype],
      subtype: input.subtype,
      title: input.title,
      // プレースホルダー画像はジャンル単位の5種のまま(アルバムと曲、映画とドラマで
      // 絵を分ける必要はないため)
      primary_image_ref: MANUAL_PLACEHOLDER_IMAGE[SUBTYPE_TO_GENRE[input.subtype]],
      owner_user_id: input.ownerUserId,
      merged_into_id: null,
      created_at: now,
      updated_at: now,
    })
    .compile();

  const insertShelfEntry = compileShelfEntryInsert(db, catalogId, shelfEntryValues);

  await d1.batch([
    d1.prepare(insertCatalogEntity.sql).bind(...insertCatalogEntity.parameters),
    d1.prepare(insertShelfEntry.sql).bind(...insertShelfEntry.parameters),
  ]);

  if (imageUpload) {
    try {
      await imageUpload.r2.put(`manual/${catalogId}.jpg`, imageUpload.bytes, {
        httpMetadata: { contentType: imageUpload.contentType },
      });
      await db
        .updateTable("catalog_entities")
        .set({ primary_image_ref: `/api/entries/${catalogId}/image`, updated_at: nowSeconds() })
        .where("id", "=", catalogId)
        .execute();
    } catch (err) {
      // 書籍の書影取得失敗時と同じ扱い: 記録自体は既に成功済みなので、
      // プレースホルダーのまま残して処理は継続する
      console.error("[createManualCatalogEntity] 画像のアップロードに失敗しました", err);
    }
  }

  return catalogId;
}
