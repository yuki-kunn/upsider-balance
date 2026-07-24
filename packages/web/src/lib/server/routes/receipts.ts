import { Hono } from "hono";
import type { AnalyzeReceiptRequest, AnalyzeReceiptResponse } from "@upsider-balance/shared";
import type { AppEnv } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { getAdminStorage } from "../lib/firestore.js";
import { analyzeReceiptImage } from "../lib/gemini.js";
import { getDb } from "../lib/firestore.js";
import { resolveFacilityIdForUser } from "../lib/facility.js";
import { ValidationError } from "../lib/validation.js";

export const receiptsRoute = new Hono<AppEnv>();

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB（02_security.md 5章と揃える）

/**
 * POST /receipts/analyze
 * 施設 or admin。Storage上の画像パスを受け取り、Firebase Admin SDK経由で画像を取得し、
 * Gemini 2.5 Flashで解析して金額・店舗名・品目候補を返す。
 * 画像アップロード自体はクライアント→Storage直で行われ、Functionsは解析リクエストのみ処理する
 * （01_architecture.md 5章）。
 */
receiptsRoute.post("/analyze", requireRole("facility", "admin"), async (c) => {
  const authUser = c.get("authUser");
  const db = getDb();
  const facilityId = await resolveFacilityIdForUser(authUser, db);

  if (!facilityId) {
    return c.json({ error: "not_found", message: "facility not found" }, 404);
  }

  let body: AnalyzeReceiptRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "invalid JSON body" }, 400);
  }

  const receiptImagePath = body.receiptImagePath;
  if (typeof receiptImagePath !== "string" || receiptImagePath.length === 0) {
    return c.json({ error: "bad_request", message: "receiptImagePath is required" }, 400);
  }

  // 自施設のレシートパス以外へのアクセスを拒否する（Storage Rulesと同じ境界をサーバー側でも強制）
  const expectedPrefix = `facilities/${facilityId}/receipts/`;
  if (!receiptImagePath.startsWith(expectedPrefix)) {
    return c.json({ error: "forbidden", message: "receiptImagePath is outside of the caller's facility" }, 403);
  }

  try {
    const bucket = getAdminStorage().bucket();
    const file = bucket.file(receiptImagePath);
    const [exists] = await file.exists();
    if (!exists) {
      return c.json({ error: "not_found", message: "receipt image not found" }, 404);
    }

    const [metadata] = await file.getMetadata();
    const mimeType = metadata.contentType ?? "application/octet-stream";
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return c.json({ error: "bad_request", message: `unsupported content type: ${mimeType}` }, 400);
    }
    const size = Number(metadata.size ?? 0);
    if (size > MAX_IMAGE_BYTES) {
      return c.json({ error: "bad_request", message: "image exceeds 10MB limit" }, 400);
    }

    const [imageBytes] = await file.download();

    const result = await analyzeReceiptImage(imageBytes, mimeType);

    const response: AnalyzeReceiptResponse = {
      amountCandidates: result.amountCandidates,
      storeNameCandidates: result.storeNameCandidates,
      itemCandidates: result.itemCandidates,
      raw: result.raw,
    };

    return c.json(response);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ error: "bad_request", message: err.message }, 400);
    }
    // errオブジェクト全体はログに出さない。Gemini SDKのエラーにAPIキー等の
    // リクエスト情報が付随する場合があるため（02_security.md 6章）、メッセージのみ記録する。
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("POST /receipts/analyze failed:", message);
    return c.json({ error: "internal_error", message: "failed to analyze receipt" }, 500);
  }
});
