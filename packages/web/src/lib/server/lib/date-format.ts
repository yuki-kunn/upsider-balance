/** 月別zipのファイル名用ラベル（例: 2026-08）。クライアント側の$lib/date-format.tsとは
 * 用途が異なる（表示用ではなくファイル名用）ため、サーバー側に独立して置く。 */
export function formatMonthLabelForFile(year: number, month: number): string {
  const mm = String(month).padStart(2, "0");
  return `${year}-${mm}`;
}
