// OpenNext Cloudflareのcustom workerパターン。生成されたNext.jsのfetchハンドラに、
// TMDB再取得Cron(scheduled)とそのQueue consumer(queue)を追加で載せる。
// 参照: https://opennext.js.org/cloudflare/howtos/custom-worker
//       shelf-type-app-spec.md セクション5「TMDBの6ヶ月キャッシュ上限への対応」

// @ts-ignore `.open-next/worker.js` はビルド時に生成される
import { default as handler } from "./.open-next/worker.js";
import { runTmdbRefreshProducer, type TmdbRefreshMessage } from "./src/cron/tmdb-refresh-producer";
import { processTmdbRefreshBatch } from "./src/cron/tmdb-refresh-consumer";

// 【将来の注意】open-next.config.tsでR2キャッシュ(incrementalCache)やDO Queueを
// 有効化する場合、.open-next/worker.jsが追加でDOQueueHandler/DOShardedTagCache等を
// exportするようになる。custom workerはfetch以外の生成済みexportを自動で引き継がないため、
// 有効化する際はここから同様にre-exportする必要がある
// (参照: https://opennext.js.org/cloudflare/howtos/custom-worker )

export default {
  fetch: handler.fetch,

  async scheduled(_event, env: CloudflareEnv, ctx) {
    ctx.waitUntil(runTmdbRefreshProducer(env));
  },

  async queue(batch, env: CloudflareEnv) {
    // cf-typegenが生成するTMDB_REFRESH_QUEUEの型はQueue<unknown>までしか
    // 絞れない(バインディング定義自体がメッセージ型を持たないため)。
    // このQueueにはtmdb-refresh-producer.tsからしかメッセージを送信しないため、
    // 実行時には常にTmdbRefreshMessage形状であることが保証されている
    await processTmdbRefreshBatch(batch as MessageBatch<TmdbRefreshMessage>, env);
  },
} satisfies ExportedHandler<CloudflareEnv>;
