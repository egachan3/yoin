// R2画像プロキシのコアロジック(遅延補充/lazy fill方式)。
// 参照: shelf-type-app-spec.md セクション5「画像ストレージ: R2に永続保存＋遅延補充」
//       同セクション「TMDBの6ヶ月キャッシュ上限への対応」
//       同セクション「画像サイズ戦略」
//
// 【スコープ】今回実装するのはコアのプロキシ部分のみ。以下は別タスク:
// - TMDBの6ヶ月ごとの再取得Cron/Queuesジョブ(このプロキシはCache-Controlの
//   長さをTMDB由来かどうかで分けるだけで、実際の定期再取得・削除は行わない)
// - 緊急パージスイッチ
// - detailバリアント(詳細ページ自体が未実装のため。現状はgridのみ)

import type { Kysely } from "kysely";
import type { Database } from "@/db/schema";

export type ImageVariant = "grid";

export function isValidVariant(value: string): value is ImageVariant {
  return value === "grid";
}

/** R2のキーは`{work_id}/{variant}`(spec: サイズトークンをキーに含めない) */
export function buildR2Key(workId: string, variant: ImageVariant): string {
  return `${workId}/${variant}`;
}

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
/**
 * TMDB由来画像のmax-age。TMDB API Terms of Use Section 1.Cの「6ヶ月を超える
 * キャッシュ禁止」に対し、安全マージンを取って150日(約5ヶ月)にする
 * (spec: 「TMDB由来画像はmax-ageを6ヶ月未満に設定する」)。
 */
const TMDB_MAX_AGE_SECONDS = 150 * 24 * 60 * 60;

export function buildCacheControl(isTmdb: boolean): string {
  const maxAge = isTmdb ? TMDB_MAX_AGE_SECONDS : ONE_YEAR_SECONDS;
  return `public, max-age=${maxAge}, immutable`;
}

export interface ImageSourceInfo {
  /** 取得元URL(サーバー側で解決済み。クライアントから渡された値は一切使わない) */
  url: string;
  /** TMDB由来かどうか(Cache-Controlの長さを分けるため) */
  isTmdb: boolean;
}

/**
 * work_id(catalog_entities.id)から取得元URLを解決する。
 *
 * 【重要・セキュリティ】この関数以外の経路で取得元URLを決めてはならない。
 * クライアントからURLを渡させる設計にすると任意のホストへのSSRF踏み台になる
 * (spec指摘)。呼び出し元はworkId(パスパラメータの不透明なID)だけを受け取り、
 * それ以外の情報はここでDBから解決する。
 *
 * catalog_entities.primary_image_refには既に取得元の完全なURLが保存されている
 * (TMDB/MAL/IGDB/MusicBrainz/Google Booksいずれも書き込み時に構築済み)。
 * TMDB由来かどうかは、source_recordsに`source: tmdb`の行があるかで判定する
 * (movie_tvジャンルの場合のみ存在しうる)。
 */
export async function resolveImageSource(db: Kysely<Database>, workId: string): Promise<ImageSourceInfo | null> {
  const entity = await db
    .selectFrom("catalog_entities")
    .select("primary_image_ref")
    .where("id", "=", workId)
    .executeTakeFirst();
  if (!entity?.primary_image_ref) return null;

  const tmdbRecord = await db
    .selectFrom("source_records")
    .select("id")
    .where("catalog_entity_id", "=", workId)
    .where("source", "=", "tmdb")
    .executeTakeFirst();

  return { url: entity.primary_image_ref, isTmdb: tmdbRecord !== undefined };
}

const NEGATIVE_CACHE_KEY_PREFIX = "img-404";
/**
 * negative cacheの保持期間。配信元の一時的な障害ではなく「恒久的に画像が
 * 存在しない」判定に使うため、あまり短いと効果が薄く、あまり長いと配信元が
 * 後から画像を追加したケースへの追随が遅れる。24時間を判断値とする
 * (spec に具体的な数値の指定はなく、ここでの判断)。
 */
const NEGATIVE_CACHE_TTL_SECONDS = 24 * 60 * 60;

async function isNegativelyCached(kv: KVNamespace, workId: string): Promise<boolean> {
  return (await kv.get(`${NEGATIVE_CACHE_KEY_PREFIX}:${workId}`)) !== null;
}

async function markNegativelyCached(kv: KVNamespace, workId: string): Promise<void> {
  await kv.put(`${NEGATIVE_CACHE_KEY_PREFIX}:${workId}`, "1", { expirationTtl: NEGATIVE_CACHE_TTL_SECONDS });
}

export interface ImageProxyDeps {
  r2: R2Bucket;
  kv: KVNamespace;
  /** R2書き込み等、レスポンスをブロックしたくない処理をバックグラウンドで実行する */
  waitUntil: (promise: Promise<unknown>) => void;
}

const NOT_FOUND_RESPONSE_INIT: ResponseInit = { status: 404 };

/**
 * work_idの画像を返す。R2にあればそれを返し、無ければ外部から取得して
 * ユーザーに返しつつ非同期でR2に書き込む(遅延補充)。
 *
 * sourceはDB解決済みの値を受け取る(この関数自体はDBに触れない)。
 * 呼び出し元(route.ts)がresolveImageSource()で解決してから渡す設計にすることで、
 * ここをKyselyのモックなしにテストできるようにしている。
 */
export async function serveWorkImage(
  deps: ImageProxyDeps,
  workId: string,
  variant: ImageVariant,
  source: ImageSourceInfo | null,
): Promise<Response> {
  if (await isNegativelyCached(deps.kv, workId)) {
    return new Response(null, NOT_FOUND_RESPONSE_INIT);
  }

  const key = buildR2Key(workId, variant);
  const existing = await deps.r2.get(key);
  if (existing) {
    return new Response(existing.body, {
      headers: {
        "Content-Type": existing.httpMetadata?.contentType ?? "image/jpeg",
        "Cache-Control": existing.httpMetadata?.cacheControl ?? buildCacheControl(false),
      },
    });
  }

  if (!source) {
    // work_id自体が存在しない、またはprimary_image_refがnull。
    // 恒久的な状態である可能性が高いのでnegative cacheに乗せる
    deps.waitUntil(markNegativelyCached(deps.kv, workId));
    return new Response(null, NOT_FOUND_RESPONSE_INIT);
  }

  let originRes: Response;
  try {
    originRes = await fetch(source.url, { signal: AbortSignal.timeout(8000) });
  } catch {
    // タイムアウト・ネットワークエラー等。配信元が一時的に不調なだけの
    // 可能性があるため、negative cacheには乗せず次回リトライさせる
    return new Response(null, NOT_FOUND_RESPONSE_INIT);
  }

  const contentType = originRes.headers.get("content-type") ?? "";
  if (!originRes.ok || !contentType.startsWith("image/")) {
    // 配信元が明示的にエラーを返した、または画像以外を返した(想定外の
    // リダイレクト先等)。前者は書影未収録等で恒久的な可能性が高いため
    // negative cacheに乗せる。後者も同じキーに対して繰り返し起きる
    // 可能性が高いため同様に扱う
    deps.waitUntil(markNegativelyCached(deps.kv, workId));
    return new Response(null, NOT_FOUND_RESPONSE_INIT);
  }

  const cacheControl = buildCacheControl(source.isTmdb);
  const imageBytes = await originRes.arrayBuffer();

  // R2書き込みはレスポンスをブロックしない。書き込み失敗は握り潰してよい
  // (spec: 同一キーへの高頻度同時書き込みでR2が429を返すことがあるため)
  deps.waitUntil(
    deps.r2
      .put(key, imageBytes, { httpMetadata: { contentType, cacheControl } })
      .catch(() => {}),
  );

  return new Response(imageBytes, {
    headers: { "Content-Type": contentType, "Cache-Control": cacheControl },
  });
}
