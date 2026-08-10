// ハンドルの正規化・検証ロジック
// 参照: shelf-type-app-spec.md セクション11「handleの設計」
//
// MVPではhandleは不変(変更機能を作らない)。一意制約はhandle_normalizedに張り、
// 表示用のhandle自体には張らない(大文字小文字・元の見た目を保持するため)。

const RESERVED_HANDLES = new Set([
  "admin",
  "api",
  "support",
  "help",
  "about",
  "settings",
  "login",
  "logout",
  "signup",
  "signin",
  "onboarding",
  "img",
  "static",
  "assets",
  "www",
  "root",
  "yoin",
  "official",
]);

const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

export type HandleValidationError =
  | "invalid_format"
  | "reserved";

/**
 * 全角英数字・大文字を正規化してから小文字化する。
 * 一意性の判定・予約語判定はこの正規化後の値に対して行う。
 */
export function normalizeHandle(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

export function validateHandle(raw: string): { ok: true; normalized: string } | { ok: false; error: HandleValidationError } {
  const normalized = normalizeHandle(raw);

  if (!HANDLE_PATTERN.test(normalized)) {
    return { ok: false, error: "invalid_format" };
  }
  if (RESERVED_HANDLES.has(normalized)) {
    return { ok: false, error: "reserved" };
  }
  return { ok: true, normalized };
}
