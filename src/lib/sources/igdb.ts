// IGDB APIクライアント。ゲームの検索・ID直接照会・推定消費時間取得。
// 参照: shelf-type-app-spec.md セクション3.5「ゲームのデータソース選定」
//       セクション5.4「アプリ内検索のクエリ設計」
//       セクション5「IGDBのOAuth2トークン保持機構」
//       セクション10「推定消費時間のロジック」

import { z } from "zod";

const IGDB_API_BASE = "https://api.igdb.com/v4";
const IGDB_IMAGE_BASE = "https://images.igdb.com/igdb/image/upload";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

/** KVに保存するTwitchアクセストークンの単一キー(spec 406行目の決定) */
const TOKEN_KV_KEY = "igdb:access_token";

/**
 * 取得したトークンの実際の有効期限より短く保存する安全マージン(秒)。
 * IGDB公式ドキュメントの例では expires_in が約64.7日相当だが、実際の値は
 * レスポンスごとに変動するため、レスポンスの値からこの分だけ差し引いてTTLに使う。
 */
const TOKEN_TTL_SAFETY_MARGIN_SECONDS = 3 * 24 * 60 * 60; // 3日

export interface IgdbCandidate {
  source: "igdb";
  igdbId: number;
  title: string;
  /**
   * 日本語タイトル。alternative_namesのうち、comment(用途の説明文)に
   * "Japanese"を含み、かつ実際に日本語文字(ひらがな・カタカナ・漢字)を
   * 含むものが取れた場合のみ(pickJapaneseTitle参照)
   */
  titleJa: string | null;
  /** IGDBの画像ID。URLはbuildImageUrl()で組み立てる(cover.urlはサムネイルサイズしか返らないため) */
  coverImageId: string | null;
  releaseDate: string | null;
  platforms: string[];
  /** IGDB公式サイトの正規URL組み立てに使う。取得できない場合はnull */
  slug: string | null;
  /** game_time_to_beatsのnormally(秒)。verify時のみ取得、検索結果には含まれない */
  timeToBeatNormallySeconds: number | null;
}

/** IGDBが401(トークン失効)を返したことを表す */
export class IgdbUnauthorizedError extends Error {
  constructor() {
    super("IGDB returned 401 (token expired or invalid)");
    this.name = "IgdbUnauthorizedError";
  }
}

/** IGDBが429(レート制限)を返したことを表す。IGDBはMALと異なり標準的な429を使う */
export class IgdbRateLimitError extends Error {
  constructor() {
    super("IGDB returned 429 (rate limit exceeded)");
    this.name = "IgdbRateLimitError";
  }
}

const TwitchTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
});

/**
 * Twitchから新規トークンを発行し、KVに保存する。
 * IGDBのOAuth2トークンはリフレッシュ不可で、失効したらclient_id/secretで
 * 新規発行するしかない(spec 407行目)。
 */
async function issueAndStoreToken(
  kv: KVNamespace,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const url = new URL(TWITCH_TOKEN_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("grant_type", "client_credentials");

  const res = await fetch(url.toString(), { method: "POST", signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    // Client Secret誤り等の設定不備は、実際にはIGDB本体(/games等)ではなく
    // ここ(Twitchのトークン発行エンドポイント)で最初に失敗する。igdbFetch側の
    // ログだけでは典型的な設定不備シナリオを取り逃すため、ここにも同じ方針で
    // ログを残す(2回目レビュー指摘)。
    // 【注意】URLにはclient_secretがクエリパラメータとして含まれる(IGDB公式の
    // 指定通り)ため、url.toString()は絶対にログに出さない。ログに出すのは
    // レスポンス側のstatus/bodyのみ
    const errBody = await res.text().catch(() => "");
    console.error("[igdb] Twitchトークン発行に失敗しました", { status: res.status, body: errBody.slice(0, 500) });
    throw new Error(`Twitch token request failed: ${res.status}`);
  }
  const parsed = TwitchTokenResponseSchema.parse(await res.json());

  // 実際のexpires_inからマージン分を差し引いてTTLにする。マージンの方が
  // 大きい極端なケース(通常は起こらない)に備え、最低1時間は保存する
  const ttl = Math.max(parsed.expires_in - TOKEN_TTL_SAFETY_MARGIN_SECONDS, 3600);
  await kv.put(TOKEN_KV_KEY, parsed.access_token, { expirationTtl: ttl });

  return parsed.access_token;
}

/**
 * KVからアクセストークンを読む。存在しなければ新規発行する。
 * 全ユーザー共通の低頻度更新(58日に1回程度)・高頻度読み取りという性質上、
 * KVで十分(Durable Objectの強整合性は不要。spec 411行目)。
 */
export async function getAccessToken(
  kv: KVNamespace,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cached = await kv.get(TOKEN_KV_KEY);
  if (cached) return cached;
  return issueAndStoreToken(kv, clientId, clientSecret);
}

const CoverSchema = z.object({ image_id: z.string() }).nullable().optional();
const PlatformSchema = z.object({ name: z.string() });
const AlternativeNameSchema = z.object({
  name: z.string(),
  // 用途の説明文。"Japanese title - ..."のように付くが、統一フォーマットではない
  // ため厳密な文字列一致ではなく緩い部分一致で判定する(pickJapaneseTitle参照)
  comment: z.string().nullable().optional(),
});

const GameSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string().nullable().optional(),
  cover: CoverSchema,
  first_release_date: z.number().nullable().optional(),
  platforms: z.array(PlatformSchema).nullable().optional(),
  alternative_names: z.array(AlternativeNameSchema).nullable().optional(),
});

const GameListResponseSchema = z.array(GameSchema);

const TimeToBeatSchema = z.object({
  game_id: z.number(),
  normally: z.number().nullable().optional(),
});
const TimeToBeatListResponseSchema = z.array(TimeToBeatSchema);

/**
 * Apicalypseの文字列リテラル("...")に安全に埋め込めるようクエリをエスケープする。
 *
 * 【重要】バックスラッシュを先にエスケープしないと脱出できる。
 * ダブルクオートだけを`\"`に置換すると、入力が既にバックスラッシュを含む場合
 * (例: `foo\" test`)、置換後は元のバックスラッシュ+新しいエスケープ列で
 * `\\"`という並びになる。標準的なエスケープ文法では`\\`が「エスケープされた
 * バックスラッシュ1文字」として消費され、直後の`"`はエスケープされないまま
 * 文字列を終端してしまう。結果として、終端以降の文字列(` test"; where ...`)が
 * リテラルの外に出て、追加のApicalypse節(where/limit/sort等)を注入できる。
 * バックスラッシュを先にエスケープすることでこの脱出経路を塞ぐ。
 */
function escapeApicalypseString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unixToIsoDate(unixSeconds: number | null | undefined): string | null {
  if (unixSeconds === null || unixSeconds === undefined) return null;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** ひらがな・カタカナ・漢字のいずれかを含むかどうか(全角記号や半角カナは対象外) */
const JAPANESE_CHAR_REGEX = /[぀-ヿ一-鿿]/;

/**
 * alternative_namesから日本語タイトルを選ぶ。
 *
 * commentには"Japanese title - ..."系の説明が付くが、ローマ字表記の別名にも
 * "Japanese title - romanization"のように付くことがあり、comment側の文字列
 * だけでは実際の日本語表記かどうか判別できない(実データで確認済み)。
 * そのため、commentに"japanese"を含む候補に絞った上で、name自体に実際の
 * 日本語文字(ひらがな・カタカナ・漢字)を含むものだけを採用する。
 * 該当が複数ある場合はIGDBが返す順序のまま先頭を採用する。
 */
function pickJapaneseTitle(
  alternativeNames: z.infer<typeof AlternativeNameSchema>[] | null | undefined,
): string | null {
  if (!alternativeNames) return null;
  const japaneseTagged = alternativeNames.filter((a) => a.comment?.toLowerCase().includes("japanese"));
  return japaneseTagged.find((a) => JAPANESE_CHAR_REGEX.test(a.name))?.name ?? null;
}

function toCandidate(
  game: z.infer<typeof GameSchema>,
  timeToBeatNormallySeconds: number | null,
): IgdbCandidate {
  return {
    source: "igdb",
    igdbId: game.id,
    title: game.name,
    titleJa: pickJapaneseTitle(game.alternative_names),
    coverImageId: game.cover?.image_id ?? null,
    releaseDate: unixToIsoDate(game.first_release_date),
    platforms: (game.platforms ?? []).map((p) => p.name),
    slug: game.slug ?? null,
    timeToBeatNormallySeconds,
  };
}

/**
 * IGDBへリクエストする。401は1回だけトークン再発行して自動リトライする
 * (spec 410行目: 401時の再取得は1リクエストにつき最大1回までに制限する。
 * client_secret失効やIGDB側障害等、トークン失効以外の理由で401が続く
 * ケースを考慮しないと無限リトライループになるリスクがあるため)。
 */
async function igdbFetch(
  endpoint: string,
  body: string,
  kv: KVNamespace,
  clientId: string,
  clientSecret: string,
  isRetry = false,
): Promise<unknown> {
  const token = isRetry
    ? await issueAndStoreToken(kv, clientId, clientSecret)
    : await getAccessToken(kv, clientId, clientSecret);

  const res = await fetch(`${IGDB_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body,
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 401) {
    if (isRetry) {
      // 再発行した直後のトークンでも401になった = トークン失効以外の原因
      // (client_secret失効・IGDB側障害等)。無限ループを避けここで諦める。
      // 「設定は合っているが一時的にIGDBが不調」なケースと運用上区別できるよう、
      // ボディを必ずログに残す(MALのMalForbiddenErrorと同じ考え方)
      const errBody = await res.text().catch(() => "");
      console.error("[igdb] トークン再発行後も401を受信しました", { endpoint, body: errBody.slice(0, 500) });
      throw new IgdbUnauthorizedError();
    }
    return igdbFetch(endpoint, body, kv, clientId, clientSecret, true);
  }
  if (res.status === 429) {
    throw new IgdbRateLimitError();
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[igdb] リクエストが失敗しました", { endpoint, status: res.status, body: errBody.slice(0, 500) });
    throw new Error(`IGDB request failed: ${res.status}`);
  }
  return res.json();
}

/**
 * ゲームを検索する。編集版(Collector's Edition等)はversion_parentがnullでない
 * ため除外する(公式ドキュメントのサンプルクエリに倣う。棚に同一ゲームの
 * 派生版が並んでノイズになるのを防ぐ)。
 *
 * cover.image_idのみ取得し、cover.urlは使わない。cover.urlが返すのは
 * t_thumbサイズ(90x90相当)で棚グリッドには小さすぎるため、image_idから
 * 自前で目的のサイズのURLを組み立てる(buildImageUrl参照)。
 *
 * time_to_beatはここでは取得しない(検索結果1件ごとに追加のAPI呼び出しが
 * 必要になり、TMDB/MALのverify時取得と同じくID確定後のみ行う)。
 */
export async function searchGames(
  query: string,
  kv: KVNamespace,
  clientId: string,
  clientSecret: string,
  limit = 10,
): Promise<IgdbCandidate[]> {
  const escapedQuery = escapeApicalypseString(query);
  const body = `search "${escapedQuery}"; fields name,slug,cover.image_id,first_release_date,platforms.name,alternative_names.name,alternative_names.comment; where version_parent = null; limit ${limit};`;
  const json = await igdbFetch("/games", body, kv, clientId, clientSecret);
  const games = GameListResponseSchema.parse(json);
  return games.map((g) => toCandidate(g, null));
}

/**
 * クライアントが送ってきたigdbIdを、IGDBへの再照会で検証する。
 * 併せてgame_time_to_beatsも取得し、推定消費時間の算出に使う。
 */
export async function verifyGameById(
  igdbId: number,
  kv: KVNamespace,
  clientId: string,
  clientSecret: string,
): Promise<IgdbCandidate | null> {
  const gameBody = `fields name,slug,cover.image_id,first_release_date,platforms.name,alternative_names.name,alternative_names.comment; where id = ${igdbId};`;
  const gameJson = await igdbFetch("/games", gameBody, kv, clientId, clientSecret);
  const games = GameListResponseSchema.parse(gameJson);
  const game = games[0];
  if (!game) return null;

  // time_to_beatは未収録タイトルもある(spec 10行目)ため、0件でも例外にせず
  // timeToBeatNormallySeconds=nullとして扱う(duration_pendingに倒す判断は呼び出し側)
  let normally: number | null = null;
  try {
    const ttbBody = `fields game_id,normally; where game_id = ${igdbId};`;
    const ttbJson = await igdbFetch("/game_time_to_beats", ttbBody, kv, clientId, clientSecret);
    const ttbList = TimeToBeatListResponseSchema.parse(ttbJson);
    normally = ttbList[0]?.normally ?? null;
  } catch {
    // time_to_beat取得の失敗でゲーム自体の追加を止めない。durationはpendingに倒れる
    normally = null;
  }

  return toCandidate(game, normally);
}

/**
 * 画像URLを組み立てる。cover_big_2x(528x748相当)を使う。
 * 棚グリッドはaspect-ratio 2/3・Retinaで実効280px以上必要なため
 * (TMDBのw500、MALのlarge優先と同じ理由でサイズを選定)。
 *
 * 【注意】IGDBの画像は削除・差し替えから30日で消える(公式ドキュメント記載)。
 * TMDBの6ヶ月キャッシュ上限より短いサイクル。定期再取得ジョブは他ジャンルと
 * 合わせて画像プロキシ実装時に一括対応する方針(既存合意)。
 */
export function buildImageUrl(imageId: string): string {
  return `${IGDB_IMAGE_BASE}/t_cover_big_2x/${imageId}.jpg`;
}

export interface DurationEstimate {
  estimatedSeconds: number | null;
  pending: 0 | 1;
  rawValue: string | null;
  rawUnit: string | null;
}

/**
 * 推定消費時間を算出する(spec 10)。game_time_to_beatsのnormally(秒)を
 * そのまま使う。未収録タイトルもある(spec 10)ため、取得できなければ
 * duration_pending=1に倒す(「値が無い」ではなく「将来埋まり得る」区分。
 * book/music/movie/anime-mangaと同じ考え方)。
 */
export function computeDuration(candidate: IgdbCandidate): DurationEstimate {
  const normally = candidate.timeToBeatNormallySeconds;
  if (!normally || normally <= 0) {
    return { estimatedSeconds: null, pending: 1, rawValue: null, rawUnit: null };
  }
  return {
    estimatedSeconds: normally,
    pending: 0,
    rawValue: String(normally),
    rawUnit: "second",
  };
}

/**
 * source_records.raw_fieldsに保存する値を組み立てる。
 * MALと違いIGDBのゲームメタデータにユーザー生成コンテンツの集約物に
 * 相当するフィールド(あらすじ・スコア等)は含めていない(そもそも取得
 * フィールドに含めていないため)。ホワイトリストとしてテストで固定する
 * 点はMALと揃える(spec 5.4「強制手段はコードレビュー運用に頼らない」)。
 */
export function buildRawFields(candidate: IgdbCandidate): Record<string, unknown> {
  return {
    title: candidate.title,
    titleJa: candidate.titleJa,
    slug: candidate.slug,
    releaseDate: candidate.releaseDate,
    platforms: candidate.platforms,
    timeToBeatNormallySeconds: candidate.timeToBeatNormallySeconds,
  };
}

/** 日本語タイトルがあればそれを優先する(日本市場向けの差別化。spec 6章、MALと同じ考え方) */
export function displayTitle(candidate: Pick<IgdbCandidate, "title" | "titleJa">): string {
  return candidate.titleJa?.trim() || candidate.title;
}

/**
 * IGDB公式サイトの正規URLを組み立てる。slugが取得できない場合(まれ)は、
 * 数値IDでは正しいURLにならないためnullを返す(TMDB/MALと違い、IGDBの
 * 公開URLはスラッグ形式のため)。
 */
export function buildSourceUrl(candidate: Pick<IgdbCandidate, "slug">): string | null {
  return candidate.slug ? `https://www.igdb.com/games/${candidate.slug}` : null;
}

/**
 * IGDBを叩く全経路(検索・追加)で共有するレート制限の設定。
 *
 * Client IDは全ユーザーで共有される単一のグローバル資源。IGDB自体の制限
 * (4req/秒、公式ドキュメント記載)はMALより緩いが、共有資源である点は同じ
 * なので、1人の過剰利用が全ユーザーに波及する経路を塞ぐ(MALと同じ考え方)。
 * route.tsではなくここに置く理由もMALと同じ(Next.jsのroute.tsはGET/POST等
 * 以外のexportを許さない)。
 */
export const IGDB_RATE_LIMIT = { windowSeconds: 60, maxRequests: 60 };
export const IGDB_RATE_LIMIT_KEY = "igdb";
