import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { fetchCoverByIsbn } from "@/lib/sources/google-books";
import { findBookByIsbn } from "@/lib/sources/ndl";
import { checkRateLimit } from "@/lib/rate-limit";

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

// shelf/books/route.tsのAddBookSchemaと同じ上限(レビュー指摘: このエンドポイントだけ
// 長さ制限が無かった)
const NDL_BIB_ID_MAX_LENGTH = 50;
const ISBN_MAX_LENGTH = 20;

// 独立したエンドポイントとして直接叩けるため、検索(NDL応答速度)という
// 自然な律速に頼らず明示的にレート制限する(レビュー指摘: 通常の検索operationは
// 1回につき最大5回しか呼ばれないが、直接叩けば無制限に呼べてしまう)
const RATE_LIMIT = { windowSeconds: 60, maxRequests: 30 };

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
	if (!ndlBibId || ndlBibId.length > NDL_BIB_ID_MAX_LENGTH || (isbn && isbn.length > ISBN_MAX_LENGTH)) {
		return Response.json({ error: "invalid_query", message: "ndlBibIdを指定してください。" }, { status: 422 });
	}

	if (!(await checkRateLimit(env.RATE_LIMIT, "search-books-cover", session.user.id, RATE_LIMIT))) {
		return Response.json({ error: "rate_limited", message: "試行回数が多すぎます。" }, { status: 429 });
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

	// 【重要・セキュリティ】isbnはクライアントからの申告値のため、ndlBibIdとの
	// 対応関係をNDLへの再照会で検証してからでないとGoogle Booksへ渡さない
	// (shelf/books/route.tsのverifyBookCandidateと同じ設計思想。これをせずに
	// isbnをそのまま信頼すると、認証済みユーザーなら誰でも実際の検索経由とは
	// 無関係に任意のISBNでGoogle Booksを呼べる、実質的な汎用プロキシになって
	// しまう。レビュー指摘で発見)
	try {
		const verified = await findBookByIsbn(isbn);
		if (!verified || verified.ndlBibId !== ndlBibId) {
			return Response.json({ imageUrl: null });
		}
		const imageLinks = await fetchCoverByIsbn(isbn, env.GOOGLE_BOOKS_API_KEY);
		return Response.json({ imageUrl: imageLinks?.thumbnail ?? null });
	} catch {
		return Response.json({ imageUrl: null });
	}
}
