import { defineConfig } from "vitest/config";
import path from "node:path";

// tsconfig.jsonの"@/*" -> "./src/*"と同じエイリアスをvitestにも設定する。
// これまでテスト対象のコードは型のみのimport(erasableなためエイリアス未設定でも
// 問題にならなかった)しか使っていなかったが、cron/tmdb-refresh-producer.tsが
// createDb(実行時に必要な値のimport)を@/db/clientから読み込むようになり、
// エイリアス未解決でテストが落ちることが判明したため追加した。
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
