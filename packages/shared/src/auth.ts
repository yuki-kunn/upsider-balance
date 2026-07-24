/**
 * 施設ID/adminIDを疑似メールアドレスに変換するロジック。
 * Firebase Authenticationはメール/パスワード認証を使うため、施設ID/adminIDを
 * 非到達ドメインのメールアドレスに変換して登録する（02_security.md 2.1）。
 *
 * このファイルは packages/web/src/lib/auth.ts（ログイン処理）と
 * scripts/create-account.ts（アカウント発行）の両方から参照し、
 * ドメイン・変換規則が食い違わないようにする。
 */

export const FACILITY_EMAIL_DOMAIN = "facility.upsider-balance.local";
export const ADMIN_EMAIL_DOMAIN = "admin.upsider-balance.local";

export function facilityIdToEmail(facilityId: string): string {
  return `${facilityId}@${FACILITY_EMAIL_DOMAIN}`;
}

export function adminIdToEmail(adminId: string): string {
  return `${adminId}@${ADMIN_EMAIL_DOMAIN}`;
}
