// KVを使った簡易レート制限。
//
// 【この実装で防げること・防げないこと】
// - 防げる: 分オーダー以上にわたる継続的な過剰利用(スクリプトによる連続リクエスト等)
// - 防げない: 数秒間の短時間バースト。Workers KVのgetはエッジでキャッシュされ
//   (既定cacheTTL 60秒)、書き込みの反映に最大60秒かかり得るため、連打では
//   古い値を読んで上限を超えて通過する
//
// MALのように「1req/秒」を厳密に守りたい相手には本来不十分で、その場合は
// Workersのrate limiting binding(コロ内メモリで即時反映)が適する。
// MVPでは共有Client IDが継続的に焼かれる経路を塞ぐことを目的とし、この方式に留める。

export interface RateLimitOptions {
  /** 窓の長さ(秒) */
  windowSeconds: number;
  /** 1つの窓で許可する回数 */
  maxRequests: number;
}

/**
 * 固定窓方式でレート制限を判定する。上限に達していなければカウントを進めてtrueを返す。
 *
 * 【重要】キーに時刻バケットを含めることで固定窓にしている。
 * 単一キーにexpirationTtlを付け直す実装だと、リクエストのたびにTTLが延長され
 * 「最後のリクエストから無操作でwindowSeconds経過するまでリセットされない」
 * という別物の挙動になる。作品をまとめて棚に入れるような正常な連続操作で
 * 上限に達し、そこから操作が止まるという事故につながる。
 */
export async function checkRateLimit(
  kv: KVNamespace,
  keyPrefix: string,
  identifier: string,
  { windowSeconds, maxRequests }: RateLimitOptions,
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `${keyPrefix}:${identifier}:${bucket}`;

  const current = await kv.get(key);
  const count = current ? Number(current) : 0;
  if (count >= maxRequests) {
    // 上限到達時は書き込まない。ここでputするとTTLが延びて窓が明けなくなる
    return false;
  }
  // バケット切り替わり後の残骸を残さないよう、TTLは窓2つ分にしておく
  await kv.put(key, String(count + 1), { expirationTtl: windowSeconds * 2 });
  return true;
}
