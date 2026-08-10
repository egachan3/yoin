# Yoin

余韻 — 観た・読んだ・聴いたものを横断的に記録し、「棚」として並べる個人向けメディア消費トラッカー。

設計メモ: Obsidian MainVault内 `Projects/shelf-type-app-spec.md` 参照。

## スタック

Next.js on Cloudflare Workers（`@opennextjs/cloudflare`）、D1（SQLite）、Kysely、better-auth。

## 開発

```bash
npm run dev
```

D1のマイグレーション（ローカル）:

```bash
npx wrangler d1 migrations apply yoin-db --local
```

Cloudflareランタイム込みでのプレビュー:

```bash
npm run preview
```

デプロイ:

```bash
npm run deploy
```
