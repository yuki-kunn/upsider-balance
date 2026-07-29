/**
 * 購入日時(purchasedAt)の表示・編集用フォーマットヘルパー。
 * ダッシュボード・admin編集・月別履歴ページの複数箇所で使うため共通化する。
 */

/** epoch ms を <input type="datetime-local"> にそのままbindできる文字列に変換する（ローカルタイムゾーン基準） */
export function millisToDatetimeLocal(millis: number): string {
  const d = new Date(millis);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/** <input type="datetime-local"> の値(ローカルタイムゾーン基準の文字列)をepoch msに変換する */
export function datetimeLocalToMillis(value: string): number | null {
  if (!value) return null;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

export function formatDateTime(millis: number): string {
  return new Date(millis).toLocaleString("ja-JP");
}

export function formatMonthLabel(year: number, month: number): string {
  return `${year}年${month}月`;
}
