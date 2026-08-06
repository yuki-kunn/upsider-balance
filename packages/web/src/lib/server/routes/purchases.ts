import { Hono } from "hono";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { CreatePurchaseRequest, PurchaseListItem } from "@upsider-balance/shared";
import type { AppEnv } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { getDb } from "../lib/firestore.js";
import {
  assertValidAmount,
  assertValidTimestampMillis,
  sanitizeReceiptOcrRaw,
  sanitizeText,
  ValidationError,
} from "../lib/validation.js";
import { resolveFacilityIdForUser } from "../lib/facility.js";
import { respondWithError } from "../lib/error-response.js";
import { syncPurchaseToNotion } from "../lib/notion-sync.js";

export const purchasesRoute = new Hono<AppEnv>();

/**
 * POST /purchases
 * 施設 or admin。金額バリデーション後、Firestoreトランザクションで
 * 「残額減算」と「purchases追加」を同時に行う（01_architecture.md 3.2 / 02_security.md 3.4）。
 * マイナス残高は許容する（00_requirements.md 4.2）。
 */
purchasesRoute.post("/", requireRole("facility", "admin"), async (c) => {
  const db = getDb();
  const facilityId = await resolveFacilityIdForUser(c.get("authUser"), db);
  if (!facilityId) {
    return c.json({ error: "not_found", message: "facility not found" }, 404);
  }

  let body: CreatePurchaseRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "invalid JSON body" }, 400);
  }

  try {
    const amount = assertValidAmount(body.amount, { fieldName: "amount" });
    const storeName = sanitizeText(body.storeName, { fieldName: "storeName", maxLength: 100 });
    const memo = sanitizeText(body.memo, { fieldName: "memo", maxLength: 200 });
    const purchasedAtMillis =
      body.purchasedAt !== undefined
        ? assertValidTimestampMillis(body.purchasedAt, { fieldName: "purchasedAt" })
        : Date.now();
    const receiptImagePath =
      typeof body.receiptImagePath === "string" && body.receiptImagePath.length > 0 ? body.receiptImagePath : null;
    const receiptOcrRaw = sanitizeReceiptOcrRaw(body.receiptOcrRaw, { fieldName: "receiptOcrRaw" });

    const balanceRef = db.doc(`facilities/${facilityId}/balance/current`);
    const purchaseRef = db.collection(`facilities/${facilityId}/purchases`).doc();

    const result = await db.runTransaction(async (tx) => {
      const balanceSnap = await tx.get(balanceRef);
      if (!balanceSnap.exists) {
        throw new ValidationError("balance not initialized for this facility");
      }
      const currentAmount = (balanceSnap.data()?.amount as number | undefined) ?? 0;
      const nextAmount = currentAmount - amount;

      tx.set(
        balanceRef,
        {
          amount: nextAmount,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: "system",
        },
        { merge: true },
      );

      tx.set(purchaseRef, {
        amount,
        storeName,
        memo,
        purchasedAt: Timestamp.fromMillis(purchasedAtMillis),
        receiptImagePath,
        receiptOcrRaw,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        editedByAdmin: false,
        facilityId,
        notionSyncStatus: "notSynced",
        notionSyncError: null,
      });

      return { nextAmount };
    });

    // Notionへの同期は購入登録の成否に影響させない（失敗してもpurchases作成・残額減算は確定済み）。
    // Vercelのサーバーレス環境ではレスポンス送信後の処理継続が保証されないため、
    // ここでawaitして完了させてからレスポンスを返す。
    const notionSync = await syncPurchaseToNotion(db, facilityId, purchaseRef.id, {
      amount,
      storeName,
      memo,
      purchasedAt: Timestamp.fromMillis(purchasedAtMillis),
      receiptImagePath,
    });

    return c.json(
      {
        id: purchaseRef.id,
        balanceAmount: result.nextAmount,
        notionSyncStatus: notionSync.notionSyncStatus,
      },
      201,
    );
  } catch (err) {
    return respondWithError(c, err, "failed to create purchase");
  }
});

/**
 * GET /purchases
 * 施設 or admin。purchasedAt desc でページネーション。
 * クエリパラメータ:
 *   - limit (default 20, max 100), cursor (前回レスポンスのnextCursor)
 *   - year, month (両方指定した場合、その月のpurchasedAtを持つ購入のみに絞り込む。
 *     1〜12月、その月内は全件返す＝limit/cursorは無視する)
 */
purchasesRoute.get("/", requireRole("facility", "admin"), async (c) => {
  const db = getDb();
  const facilityId = await resolveFacilityIdForUser(c.get("authUser"), db);
  if (!facilityId) {
    return c.json({ error: "not_found", message: "facility not found" }, 404);
  }

  const yearParam = c.req.query("year");
  const monthParam = c.req.query("month");

  let query = db.collection(`facilities/${facilityId}/purchases`).orderBy("purchasedAt", "desc");

  if (yearParam !== undefined || monthParam !== undefined) {
    const year = Number(yearParam);
    const month = Number(monthParam);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return c.json({ error: "bad_request", message: "year and month must be valid integers (month: 1-12)" }, 400);
    }
    const rangeStart = new Date(year, month - 1, 1);
    const rangeEnd = new Date(year, month, 1);
    query = query
      .where("purchasedAt", ">=", Timestamp.fromDate(rangeStart))
      .where("purchasedAt", "<", Timestamp.fromDate(rangeEnd));

    const snap = await query.get();
    const purchases = mapPurchaseDocs(snap.docs);
    return c.json({ purchases, nextCursor: null });
  }

  const limitParam = Number(c.req.query("limit") ?? "20");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 100) : 20;
  const cursor = c.req.query("cursor");

  query = query.limit(limit);

  if (cursor) {
    const cursorMillis = Number(cursor);
    if (!Number.isFinite(cursorMillis)) {
      return c.json({ error: "bad_request", message: "invalid cursor" }, 400);
    }
    query = query.startAfter(Timestamp.fromMillis(cursorMillis));
  }

  const snap = await query.get();
  const purchases = mapPurchaseDocs(snap.docs);

  const last = snap.docs.at(-1);
  const nextCursor =
    last && snap.docs.length === limit ? String((last.data().purchasedAt as FirebaseFirestore.Timestamp).toMillis()) : null;

  return c.json({ purchases, nextCursor });
});

/**
 * Firestoreドキュメントを一覧APIレスポンス用の形状に変換する。
 * receiptOcrRaw（Gemini解析の生データ）は一覧表示に不要なため含めない
 * （履歴が増えるほど転送量が無駄に増えるのを防ぐ、tech-debt issue #10）。
 */
function mapPurchaseDocs(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
): PurchaseListItem[] {
  return docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      amount: data.amount,
      storeName: data.storeName ?? null,
      memo: data.memo ?? null,
      purchasedAt: (data.purchasedAt as FirebaseFirestore.Timestamp).toMillis(),
      receiptImagePath: data.receiptImagePath ?? null,
      createdAt: (data.createdAt as FirebaseFirestore.Timestamp)?.toMillis?.() ?? Date.now(),
      updatedAt: (data.updatedAt as FirebaseFirestore.Timestamp)?.toMillis?.() ?? Date.now(),
      editedByAdmin: Boolean(data.editedByAdmin),
      facilityId: data.facilityId,
      notionSyncStatus: data.notionSyncStatus ?? "notSynced",
      notionSyncError: data.notionSyncError ?? null,
      notionPageId: data.notionPageId ?? null,
    };
  });
}
