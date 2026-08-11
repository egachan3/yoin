import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";

// D1バインディングはCloudflare Workersのリクエストごとのenvからしか取れないため、
// シングルトンにせずリクエスト単位で呼び出す関数として提供する(src/db/client.tsと同じ理由)。
//
// database に生のD1Databaseを渡すと、better-authが内部でD1専用のKysely dialect
// (D1SqliteDialect)を自動選択する(duck-typingで"batch"/"exec"/"prepare"を検出)。
// D1にはインタラクティブなトランザクションがなく、database.transactionのデフォルトは
// false(逐次実行)なので、サインアップ時のuser行+account行の書き込みも
// beginTransaction()を試みずに安全に処理される(node_modules内の実装で確認済み)。
export function createAuth(env: { DB: D1Database; RESEND_API_KEY?: string; EMAIL_FROM?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; BETTER_AUTH_SECRET?: string; BETTER_AUTH_URL?: string; NEXTJS_ENV?: string }) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,

    // パスワード認証は採用しない(自前のハッシュ化・リセットフローの責任を負わない方針)
    emailAndPassword: {
      enabled: false,
    },

    // Sign in with Appleは提供しない(Apple Developer Programの支払いを収益化まで先送りする方針のため)
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      },
    },

    // アカウント連携は最初から有効(後付けは重複アカウントの棚をマージするデータ移行になるため)
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
      },
    },

    // 全リクエストでDBを叩かない構成にする
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },

    // handle関連はここでは書き込み経路を開けない(正規化・予約語チェック・一意性検証を
    // 伴う専用のオンボーディングフローが別途必要なため、input: falseにして
    // 汎用のupdateUser経由での書き込みを塞いでおく)
    user: {
      additionalFields: {
        handle: { type: "string", required: false, input: false },
        handle_normalized: { type: "string", required: false, input: false },
        timezone: { type: "string", required: false, input: false, defaultValue: "Asia/Tokyo" },
        is_public: { type: "boolean", required: false, input: false, defaultValue: false },
      },
    },

    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
            // 開発環境限定のフォールバック: メール送信サービスが未設定でも
            // ログインフローを最後まで通せるよう、リンクをサーバーログに
            // 出力する(E2E動作確認・ローカル開発用。本番はRESEND_API_KEY/
            // EMAIL_FROMが必須のnodejs_compat環境なのでこの分岐には来ない)
            if (env.NEXTJS_ENV === "development") {
              console.log(`[dev] マジックリンク(${email}宛): ${url}`);
              return;
            }
            throw new Error(
              "RESEND_API_KEY / EMAIL_FROM が未設定です。Resendでアカウントとドメインを用意し、.dev.vars / wrangler secret に設定してください。",
            );
          }
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: env.EMAIL_FROM,
              to: email,
              subject: "Yoinへのログインリンク",
              html: `<p>以下のリンクからログインしてください(5分間有効):</p><p><a href="${url}">${url}</a></p>`,
            }),
          });
          if (!res.ok) {
            throw new Error(`マジックリンクの送信に失敗しました: ${res.status} ${await res.text()}`);
          }
        },
      }),
    ],
  });
}
