/**
 * Firestore Admin SDK / Client SDK の Timestamp 型に依存しない共通表現。
 * web(SvelteKit) / functions(Hono) の双方で変換して利用する。
 * Unixミリ秒（epoch ms）で統一する。
 */
export type TimestampMillis = number;

// ---------------------------------------------------------------------------
// Firestore ドキュメント型
// ---------------------------------------------------------------------------

/** facilities/{facilityId} */
export interface Facility {
  name: string;
  loginId: string;
  authUid: string;
  createdAt: TimestampMillis;
  updatedAt: TimestampMillis;
}

/** facilities/{facilityId}/balance/current */
export interface Balance {
  amount: number;
  updatedAt: TimestampMillis;
  /** 直近更新者種別。個人識別はしない */
  updatedBy: "system" | "admin";
}

/** facilities/{facilityId}/purchases/{purchaseId} */
export interface Purchase {
  id: string;
  amount: number;
  memo: string | null;
  purchasedAt: TimestampMillis;
  receiptImagePath: string | null;
  /** Gemini解析結果の生データ（任意保持） */
  receiptOcrRaw: Record<string, unknown> | null;
  createdAt: TimestampMillis;
  updatedAt: TimestampMillis;
  editedByAdmin: boolean;
  /** 非正規化。将来のコレクショングループクエリ用 */
  facilityId: string;
}

/**
 * GET /api/purchases のレスポンス項目。
 * 一覧表示では不要な receiptOcrRaw（Gemini解析生データ）を除外した型
 * （転送量削減、tech-debt issue #10対応）。
 */
export type PurchaseListItem = Omit<Purchase, "receiptOcrRaw">;

/** admins/{adminId} */
export interface Admin {
  loginId: string;
  authUid: string;
  createdAt: TimestampMillis;
}

// ---------------------------------------------------------------------------
// Custom Claims
// ---------------------------------------------------------------------------

export type UserRole = "facility" | "admin";

export type CustomClaims =
  | { role: "facility"; facilityId: string }
  | { role: "admin" };

// ---------------------------------------------------------------------------
// API リクエスト/レスポンス型
// ---------------------------------------------------------------------------

/** POST /api/purchases */
export interface CreatePurchaseRequest {
  amount: number;
  memo?: string | null;
  purchasedAt?: TimestampMillis;
  receiptImagePath?: string | null;
  receiptOcrRaw?: Record<string, unknown> | null;
}

/** PATCH /api/admin/purchases/:id */
export interface UpdatePurchaseRequest {
  amount?: number;
  memo?: string | null;
  purchasedAt?: TimestampMillis;
}

/** PATCH /api/admin/balance */
export interface UpdateBalanceRequest {
  /** 上書きの場合はamount、増減の場合はdeltaのいずれかを指定 */
  amount?: number;
  delta?: number;
}

/** POST /api/receipts/analyze */
export interface AnalyzeReceiptRequest {
  receiptImagePath: string;
}

/** POST /api/receipts/analyze のレスポンス（Gemini解析結果） */
export interface AnalyzeReceiptResponse {
  amountCandidates: number[];
  storeNameCandidates: string[];
  itemCandidates: string[];
  /** Geminiの生応答（デバッグ・保存用） */
  raw: Record<string, unknown>;
}
