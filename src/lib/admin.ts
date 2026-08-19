// 管理画面(通報対応)のアクセス制御。Apple 1.2対応(spec shelf-type-app-spec.md
// セクション11)の「報告から24時間以内の対応」ワークフロー用。
// ロール列をDBに持つほどの規模ではないため、環境変数ADMIN_EMAILS
// (カンマ区切り)に登録されたメールアドレスの本人のみ管理者として扱う。
export function isAdminEmail(email: string | undefined | null, adminEmailsEnv: string | undefined): boolean {
  if (!email || !adminEmailsEnv) return false;
  const admins = adminEmailsEnv
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return admins.includes(email.toLowerCase());
}
