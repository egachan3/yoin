import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { fetchCoverByIsbn } from "@/lib/sources/google-books";

/**
 * 書籍1件分の書影URLだけを返す軽量エンドポイント。
 *
 * 【背景】以前は/api/search/booksが検索結果を返す前に上位5件のGoogle Books
 * 問い合わせを直列で待っており、Google Books側の応答(実測1.3〜1.5秒)が
 * そのまま検索全体の体感速度になっていた(ユーザー指摘で発覚)。書影は
 * 検索結果の本質ではないため、一覧はGoogle Booksを待たずに即座に返し、
 * 各カードがマウント後にこのエンドポイントを個別に呼んで画像だけ後から
 * 差し込む設計に変更した(映画・アニメ等の画像遅延読み込みと同じ発想)。
 */
export async function GET(request: Request) {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);

	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}

	const { searchParams } = new URL(request.url);
	const ndlBibId = searchParams.get("ndlBibId");
	const isbn = searchParams.get("isbn");
	if (!ndlBibId) {
		return Response.json({ error: "invalid_query", message: "ndlBibIdを指定してください。" }, { status: 422 });
	}

	// 既に誰か1人でもこの本(NDL書誌ID)を棚に追加済みなら、Google Booksへは
	// 問い合わせず永続保存済みの画像を再利用する(/api/search/booksの
	// attachCoverImagesと同じロジック)
	try {
		const db = createDb(env.DB);
		const existing = await db
			.selectFrom("source_records")
			.innerJoin("catalog_entities", "catalog_entities.id", "source_records.catalog_entity_id")
			.select("catalog_entities.primary_image_ref")
			.where("source_records.source", "=", "ndl")
			.where("source_records.source_id", "=", ndlBibId)
			.where("source_records.deletion_status", "=", "active")
			.executeTakeFirst();
		if (existing) {
			return Response.json({ imageUrl: existing.primary_image_ref });
		}
	} catch {
		// 既存カタログの照会に失敗しても、Google Booksへの新規問い合わせに
		// フォールバックするだけでこのエンドポイント自体は成立させる
	}

	if (!isbn) {
		return Response.json({ imageUrl: null });
	}

	try {
		const imageLinks = await fetchCoverByIsbn(isbn, env.GOOGLE_BOOKS_API_KEY);
		return Response.json({ imageUrl: imageLinks?.thumbnail ?? null });
	} catch {
		return Response.json({ imageUrl: null });
	}
}
