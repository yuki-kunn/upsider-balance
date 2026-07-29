/**
 * 購入日時(purchasedAt)の表示・編集用フォーマットヘルパー。
 * ダッシュボード・admin編集・月別履歴ページの複数箇所で使うため共通化する。
 * レシート解析(Gemini)は時刻を読み取らないため、ユーザーには日付のみを入力させる。
 * 時刻部分は登録・編集時点の既存値をそのまま保持する。
 */

/** epoch ms を <input type="date"> にそのままbindできる文字列に変換する（ローカルタイムゾーン基準） */
export function millisToDateInput(millis: number): string {
  const d = new Date(millis);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * <input type="date"> の値(ローカルタイムゾーン基準)と、保持したい時刻(epoch ms)を組み合わせてepoch msに変換する。
 * 時刻部分はkeepTimeMillisの時:分:秒.ミリ秒をそのまま引き継ぐ。
 */
export function dateInputToMillis(value: string, keepTimeMillis: number): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const keep = new Date(keepTimeMillis);
  const result = new Date(year, month - 1, day, keep.getHours(), keep.getMinutes(), keep.getSeconds(), keep.getMilliseconds());
  const millis = result.getTime();
  return Number.isFinite(millis) ? millis : null;
}

export function formatDate(millis: number): string {
  return new Date(millis).toLocaleDateString("ja-JP");
}

export function formatMonthLabel(year: number, month: number): string {
  return `${year}年${month}月`;
}
