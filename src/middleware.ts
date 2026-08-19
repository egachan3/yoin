import { NextResponse, type NextRequest } from "next/server";

/**
 * "/@handle"または"/@handle/..."を"/u/handle"または"/u/handle/..."に
 * 変換する。マッチしない場合はnull(呼び出し側でrewriteせずそのまま通す)。
 * NextRequestに依存しない純粋関数にして、パターン自体を単体でテストできる
 * ようにしている(URLの組み立てミスはmiddleware全体を経由しないと
 * 気づきにくいため)。
 */
export function resolvePublicShelfRewritePath(pathname: string): string | null {
	const match = pathname.match(/^\/@([^/]+)(\/.*)?$/);
	if (!match) return null;
	const [, handle, rest] = match;
	return `/u/${handle}${rest ?? ""}`;
}

/**
 * 公開棚のURLは/@handle形式(spec: shelf-type-app-spec.md セクション11
 * 「handleの設計」)。ただしNext.js App Routerでは"@"始まりのフォルダ名は
 * 並行ルート(Parallel Routes)の予約語のため、src/app/@[handle]のような
 * ファイル配置はできない。実体はsrc/app/u/[handle]に置き、ここで
 * /@handleへのリクエストだけ内部的に/u/handleへrewriteする
 * (URLバーの表示は/@handleのまま変わらない。あくまでサーバー側の解決のみ)。
 */
export function middleware(request: NextRequest) {
	const rewritePath = resolvePublicShelfRewritePath(request.nextUrl.pathname);
	if (!rewritePath) return NextResponse.next();

	const url = request.nextUrl.clone();
	url.pathname = rewritePath;
	return NextResponse.rewrite(url);
}

// "/@handle"はNext.jsのmatcher構文(path-to-regexp)で"@"を含むパターンを
// 書くと解釈がわかりにくく、実際に "/@:handle*" ではマッチしなかった
// (動作確認で404になることを確認済み)。matcherは静的アセット等の
// 明らかに関係ないパスだけ除外する形にとどめ、実際の判定は
// resolvePublicShelfRewritePath側の正規表現に委ねる
export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
