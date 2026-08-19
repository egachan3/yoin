import { NextResponse, type NextRequest } from "next/server";

// ハンドル自体の文字種チェック(src/lib/handle.tsのHANDLE_PATTERNより緩め)。
// [^/]+はドット2連(..)のようなパストラバーサル的な文字列も拾ってしまうため、
// rewrite先を組み立てる前にここで弾く。実際のハンドルの妥当性(大文字小文字・
// 予約語等)はfindUserByHandle側でnormalizeHandle()を通してから判定するので、
// ここでは「rewriteしてよい安全な文字列か」だけを見ればよい
const SAFE_HANDLE_SEGMENT = /^[a-zA-Z0-9_]{1,20}$/;

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
	if (!SAFE_HANDLE_SEGMENT.test(handle)) return null;
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
// resolvePublicShelfRewritePath側の正規表現に委ねる。
//
// 【全パスで実行される設計について】結果としてこのmiddlewareは/api/*を
// 含むほぼ全リクエストで実行される。中身は正規表現マッチ1回+早期returnの
// 軽量な処理なので現状は許容しているが、将来ここに重い処理(DB問い合わせ等)
// を足す場合は、まず対象パスをmatcherで絞れないか検討すること
export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
