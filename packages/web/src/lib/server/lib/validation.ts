/**
 * サーバー側バリデーションの共通ヘルパー。
 * 02_security.md 5章「すべてのバリデーションはHono API側で必ず再検証する」に基づく。
 */

const MIN_AMOUNT = -1_000_000;
const MAX_AMOUNT = 10_000_000;
const MAX_MEMO_LENGTH = 200;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** 金額: 整数（円単位）であることと範囲を検証する */
export function assertValidAmount(amount: unknown, opts: { fieldName?: string } = {}): number {
  const fieldName = opts.fieldName ?? "amount";
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new ValidationError(`${fieldName} must be a finite number`);
  }
  if (!Number.isInteger(amount)) {
    throw new ValidationError(`${fieldName} must be an integer (yen)`);
  }
  if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    throw new ValidationError(`${fieldName} must be between ${MIN_AMOUNT} and ${MAX_AMOUNT}`);
  }
  return amount;
}

/** メモ・店舗名等の自由入力文字列: 文字数上限・制御文字除去 */
export function sanitizeText(value: unknown, opts: { fieldName?: string; maxLength?: number } = {}): string | null {
  if (value === null || value === undefined) return null;
  const fieldName = opts.fieldName ?? "text";
  const maxLength = opts.maxLength ?? MAX_MEMO_LENGTH;
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string`);
  }
  // 制御文字を除去（改行・タブは許容）
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (stripped.length > maxLength) {
    throw new ValidationError(`${fieldName} must be ${maxLength} characters or fewer`);
  }
  return stripped.length === 0 ? null : stripped;
}

const MAX_RECEIPT_OCR_RAW_BYTES = 20_000;

/**
 * レシートOCR結果(receiptOcrRaw): クライアント由来の任意JSONをそのまま保存しない。
 * サイズ上限のみで無害化し、02_security.md 5章の「Gemini抽出結果も外部由来として扱う」方針に基づく。
 */
export function sanitizeReceiptOcrRaw(value: unknown, opts: { fieldName?: string } = {}): unknown | null {
  if (value === null || value === undefined) return null;
  const fieldName = opts.fieldName ?? "receiptOcrRaw";
  if (typeof value !== "object") {
    throw new ValidationError(`${fieldName} must be an object`);
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_OCR_RAW_BYTES) {
    throw new ValidationError(`${fieldName} exceeds maximum allowed size`);
  }
  return JSON.parse(serialized);
}

/** 購入日時: epoch ms の妥当な範囲かを検証する（極端な未来・過去を拒否） */
export function assertValidTimestampMillis(value: unknown, opts: { fieldName?: string } = {}): number {
  const fieldName = opts.fieldName ?? "purchasedAt";
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${fieldName} must be a number (epoch ms)`);
  }
  const now = Date.now();
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  if (value < now - oneYearMs || value > now + 24 * 60 * 60 * 1000) {
    throw new ValidationError(`${fieldName} is out of acceptable range`);
  }
  return value;
}
