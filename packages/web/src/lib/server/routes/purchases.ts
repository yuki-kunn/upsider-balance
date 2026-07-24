import { Hono } from "hono";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { CreatePurchaseRequest, Purchase } from "@upsider-balance/shared";
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
        memo,
        purchasedAt: Timestamp.fromMillis(purchasedAtMillis),
        receiptImagePath,
        receiptOcrRaw,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        editedByAdmin: false,
        facilityId,
      });

      return { nextAmount };
    });

    return c.json(
      {
        id: purchaseRef.id,
        balanceAmount: result.nextAmount,
      },
      201,
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ error: "bad_request", message: err.message }, 400);
    }
    console.error("POST /purchases failed", err);
    return c.json({ error: "internal_error", message: "failed to create purchase" }, 500);
  }
});

/**
 * GET /purchases
 * 施設 or admin。purchasedAt desc でページネーション。
 * クエリパラメータ: limit (default 20, max 100), cursor (前回レスポンスの nextCursor)
 */
purchasesRoute.get("/", requireRole("facility", "admin"), async (c) => {
  const db = getDb();
  const facilityId = await resolveFacilityIdForUser(c.get("authUser"), db);
  if (!facilityId) {
    return c.json({ error: "not_found", message: "facility not found" }, 404);
  }

  const limitParam = Number(c.req.query("limit") ?? "20");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 100) : 20;
  const cursor = c.req.query("cursor");

  let query = db
    .collection(`facilities/${facilityId}/purchases`)
    .orderBy("purchasedAt", "desc")
    .limit(limit);

  if (cursor) {
    const cursorMillis = Number(cursor);
    if (!Number.isFinite(cursorMillis)) {
      return c.json({ error: "bad_request", message: "invalid cursor" }, 400);
    }
    query = query.startAfter(Timestamp.fromMillis(cursorMillis));
  }

  const snap = await query.get();
  const purchases: Purchase[] = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      amount: data.amount,
      memo: data.memo ?? null,
      purchasedAt: (data.purchasedAt as FirebaseFirestore.Timestamp).toMillis(),
      receiptImagePath: data.receiptImagePath ?? null,
      receiptOcrRaw: data.receiptOcrRaw ?? null,
      createdAt: (data.createdAt as FirebaseFirestore.Timestamp)?.toMillis?.() ?? Date.now(),
      updatedAt: (data.updatedAt as FirebaseFirestore.Timestamp)?.toMillis?.() ?? Date.now(),
      editedByAdmin: Boolean(data.editedByAdmin),
      facilityId: data.facilityId,
    };
  });

  const last = snap.docs.at(-1);
  const nextCursor =
    last && snap.docs.length === limit ? String((last.data().purchasedAt as FirebaseFirestore.Timestamp).toMillis()) : null;

  return c.json({ purchases, nextCursor });
});
