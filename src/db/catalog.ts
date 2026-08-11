// catalog_entities/source_recordsへの正規化保存ロジック。
// 参照: shelf-type-app-spec.md セクション5「catalog_entitiesと正規化レイヤーの関係」

import { uuidv7 } from "uuidv7";
import type { Kysely } from "kysely";
import type { Database } from "./schema";
import type { NdlBookCandidate } from "@/lib/sources/ndl";
import { fetchCoverByIsbn } from "@/lib/sources/google-books";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
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
  candidate: NdlBookCandidate,
  googleBooksApiKey?: string,
): Promise<string> {
  const existing = await db
    .selectFrom("source_records")
    .select("catalog_entity_id")
    .where("source", "=", "ndl")
    .where("source_id", "=", candidate.ndlBibId)
    .executeTakeFirst();

  if (existing) {
    return existing.catalog_entity_id;
  }

  const catalogId = uuidv7();
  const now = nowSeconds();

  // 書影はISBNが分かっている場合のみ取得を試みる。ISBNがない書籍
  // (古い本・同人誌等)は取得自体を諦める(セクション5.4の決定通り)
  const coverImageUrl = candidate.isbn
    ? (await fetchCoverByIsbn(candidate.isbn, googleBooksApiKey).catch(() => null))?.thumbnail ?? null
    : null;

  await db
    .insertInto("catalog_entities")
    .values({
      id: catalogId,
      genre: "book",
      title: candidate.title,
      primary_image_ref: coverImageUrl,
      owner_user_id: null,
      merged_into_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  await db
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
    .execute();

  if (coverImageUrl) {
    await db
      .insertInto("source_records")
      .values({
        id: uuidv7(),
        catalog_entity_id: catalogId,
        source: "google_books",
        source_id: candidate.isbn ?? candidate.ndlBibId,
        source_url: null,
        // imageLinksのみ(google-books.tsの型自体がtitle/description等を持てない設計)
        raw_fields: JSON.stringify({ thumbnail: coverImageUrl }),
        deletion_status: "active",
        cached_at: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  return catalogId;
}
