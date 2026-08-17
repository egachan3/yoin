import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { searchBooks, type SearchField, type NdlBookCandidate } from "@/lib/sources/ndl";
import { fetchCoverByIsbn } from "@/lib/sources/google-books";
import type { Kysely } from "kysely";
import type { Database } from "@/db/schema";

function parseField(value: string | null): SearchField | undefined {
  return value === "title" || value === "creator" ? value : undefined;
}

// Google Books APIの無料枠は1日1,000件と少なく、書籍検索1回ごとに候補全件
// (最大10件)問い合わせると個人開発でもすぐ枯渇する。検索結果の上位のみ画像を
// 表示する運用に絞る(ユーザーとの合意、2026-08-17)
const IMAGE_LOOKUP_LIMIT = 5;

/**
 * 検索結果の上位IMAGE_LOOKUP_LIMIT件にのみ書影を付ける。
 *
 * 既に誰か1人でもその本(NDL書誌ID)を棚に追加済みなら、Google Booksへは
 * 問い合わせず`catalog_entities.primary_image_ref`に永続保存済みの画像を
 * そのまま使う(ユーザーとの合意: 6ヶ月キャッシュ上限のようなTMDB固有の期限は
 * Google Booksにはないため、一度取得した画像は使い回してよい)。
 * 未収録の本のみ、ISBNがあればGoogle Booksへ新規問い合わせする。
 */
async function attachCoverImages(
  db: Kysely<Database>,
  candidates: NdlBookCandidate[],
  googleBooksApiKey: string | undefined,
): Promise<(NdlBookCandidate & { imageUrl: string | null })[]> {
  const targets = candidates.slice(0, IMAGE_LOOKUP_LIMIT);
  const rest = candidates.slice(IMAGE_LOOKUP_LIMIT);

  // このDB照会は画像付与のための付加的な最適化(既存カタログの再利用によるGoogle
  // Books節約)であり、失敗しても書籍検索自体は成立させる必要がある。ここを
  // 無防備にすると、D1の一時的な障害だけでNDL検索が成功しているのに検索結果が
  // 1件も表示されなくなる(レビュー指摘: catalog_entities非原子的書き込みの過去の
  // 教訓と同じ「非クリティカル処理の失敗が本質的な処理を巻き込む」パターン)
  const bibIds = targets.map((c) => c.ndlBibId);
  let existingByBibId = new Map<string, string | null>();
  try {
    const existingRows =
      bibIds.length > 0
        ? await db
            .selectFrom("source_records")
            .innerJoin("catalog_entities", "catalog_entities.id", "source_records.catalog_entity_id")
            .select(["source_records.source_id", "catalog_entities.primary_image_ref"])
            .where("source_records.source", "=", "ndl")
            .where("source_records.source_id", "in", bibIds)
            // 現状book(ndl)のsource_recordsはdeletion_statusが常にactiveのため
            // 実害はないが、将来書籍にも削除・再取得フローが入った場合に備えて
            // 明示しておく(レビュー指摘)
            .where("source_records.deletion_status", "=", "active")
            .execute()
        : [];
    existingByBibId = new Map(existingRows.map((r) => [r.source_id, r.primary_image_ref]));
  } catch {
    // 既存カタログの照会に失敗しても、全件をGoogle Books個別問い合わせに
    // フォールバックするだけで検索結果自体は返す
  }

  const withImages = await Promise.all(
    targets.map(async (c) => {
      // 既存カタログがあれば(画像の有無に関わらず)そちらを正とし、
      // Google Booksへは再問い合わせしない
      if (existingByBibId.has(c.ndlBibId)) {
        return { ...c, imageUrl: existingByBibId.get(c.ndlBibId) ?? null };
      }
      if (!c.isbn) {
        return { ...c, imageUrl: null };
      }
      try {
        const imageLinks = await fetchCoverByIsbn(c.isbn, googleBooksApiKey);
        return { ...c, imageUrl: imageLinks?.thumbnail ?? null };
      } catch {
        return { ...c, imageUrl: null };
      }
    }),
  );

  return [...withImages, ...rest.map((c) => ({ ...c, imageUrl: null }))];
}

export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  if (!query) {
    return Response.json({ error: "invalid_query", message: "検索語を入力してください。" }, { status: 422 });
  }
  const startRecordParam = searchParams.get("startRecord");
  const startRecord = startRecordParam ? Number(startRecordParam) : 1;
  // 「もっと探す」で継続する場合、前回のレスポンスが返したfieldをそのまま
  // 渡してもらう(渡されなければ初回検索として扱い、title→creatorの
  // フォールバック判定が働く)
  const field = parseField(searchParams.get("field"));

  try {
    const result = await searchBooks(query, 10, Number.isFinite(startRecord) ? startRecord : 1, field);
    const db = createDb(env.DB);
    const candidatesWithImage = await attachCoverImages(db, result.candidates, env.GOOGLE_BOOKS_API_KEY);
    return Response.json({ ...result, candidates: candidatesWithImage });
  } catch {
    return Response.json(
      { error: "search_failed", message: "検索に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }
}
