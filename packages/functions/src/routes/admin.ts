import { Hono } from "hono";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { UpdateBalanceRequest, UpdatePurchaseRequest } from "@upsider-balance/shared";
import type { AppEnv } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { getDb } from "../lib/firestore.js";
import {
  assertValidAmount,
  assertValidTimestampMillis,
  NotFoundError,
  sanitizeText,
  ValidationError,
} from "../lib/validation.js";
import { resolveSoleFacilityId } from "../lib/facility.js";

export const adminRoute = new Hono<AppEnv>();

// admin配下は全ルートで admin ロールを要求する
adminRoute.use("*", requireRole("admin"));

/**
 * PATCH /admin/balance
 * adminのみ。残額の直接編集（amount指定で上書き、delta指定で増減）。
 * 単一施設運用のため対象施設は facilities コレクションの唯一のドキュメントを解決する。
 */
adminRoute.patch("/balance", async (c) => {
  const db = getDb();
  const facilityId = await resolveSoleFacilityId(db);
  if (!facilityId) {
    return c.json({ error: "not_found", message: "facility not found" }, 404);
  }

  let body: UpdateBalanceRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "invalid JSON body" }, 400);
  }

  try {
    if (body.amount === undefined && body.delta === undefined) {
      throw new ValidationError("either amount or delta is required");
    }
    if (body.amount !== undefined && body.delta !== undefined) {
      throw new ValidationError("specify only one of amount or delta");
    }

    const balanceRef = db.doc(`facilities/${facilityId}/balance/current`);

    const nextAmount = await db.runTransaction(async (tx) => {
      const snap = await tx.get(balanceRef);
      const currentAmount = (snap.data()?.amount as number | undefined) ?? 0;

      const newAmount =
        body.amount !== undefined
          ? assertValidAmount(body.amount, { fieldName: "amount" })
          : currentAmount + assertValidAmount(body.delta, { fieldName: "delta" });

      assertValidAmount(newAmount, { fieldName: "resulting amount" });

      tx.set(
        balanceRef,
        {
          amount: newAmount,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: "admin",
        },
        { merge: true },
      );

      return newAmount;
    });

    return c.json({ balanceAmount: nextAmount });
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ error: "bad_request", message: err.message }, 400);
    }
    console.error("PATCH /admin/balance failed", err);
    return c.json({ error: "internal_error", message: "failed to update balance" }, 500);
  }
});

/**
 * PATCH /admin/purchases/:id
 * adminのみ。購入履歴の編集。金額が変わった場合は差分を残額に反映する
 * （元の金額を残額に戻してから新しい金額を減算＝差分調整）。
 */
adminRoute.patch("/purchases/:id", async (c) => {
  const db = getDb();
  const facilityId = await resolveSoleFacilityId(db);
  if (!facilityId) {
    return c.json({ error: "not_found", message: "facility not found" }, 404);
  }
  const purchaseId = c.req.param("id");

  let body: UpdatePurchaseRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "invalid JSON body" }, 400);
  }

  try {
    const balanceRef = db.doc(`facilities/${facilityId}/balance/current`);
    const purchaseRef = db.doc(`facilities/${facilityId}/purchases/${purchaseId}`);

    const result = await db.runTransaction(async (tx) => {
      const [balanceSnap, purchaseSnap] = await Promise.all([tx.get(balanceRef), tx.get(purchaseRef)]);

      if (!purchaseSnap.exists) {
        throw new NotFoundError("purchase not found");
      }

      const purchaseData = purchaseSnap.data()!;
      const currentBalanceAmount = (balanceSnap.data()?.amount as number | undefined) ?? 0;
      const oldPurchaseAmount = purchaseData.amount as number;

      const newPurchaseAmount =
        body.amount !== undefined ? assertValidAmount(body.amount, { fieldName: "amount" }) : oldPurchaseAmount;

      // 差分を残額に反映: 旧金額をいったん戻し、新金額を減算する
      const diff = newPurchaseAmount - oldPurchaseAmount;
      const newBalanceAmount = currentBalanceAmount - diff;
      assertValidAmount(newBalanceAmount, { fieldName: "resulting balance amount" });

      const purchaseUpdate: Record<string, unknown> = {
        amount: newPurchaseAmount,
        updatedAt: FieldValue.serverTimestamp(),
        editedByAdmin: true,
      };
      if (body.memo !== undefined) {
        purchaseUpdate.memo = sanitizeText(body.memo, { fieldName: "memo", maxLength: 200 });
      }
      if (body.purchasedAt !== undefined) {
        purchaseUpdate.purchasedAt = Timestamp.fromMillis(
          assertValidTimestampMillis(body.purchasedAt, { fieldName: "purchasedAt" }),
        );
      }

      tx.update(purchaseRef, purchaseUpdate);
      tx.set(
        balanceRef,
        {
          amount: newBalanceAmount,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: "admin",
        },
        { merge: true },
      );

      return { balanceAmount: newBalanceAmount };
    });

    return c.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.json({ error: "not_found", message: err.message }, 404);
    }
    if (err instanceof ValidationError) {
      return c.json({ error: "bad_request", message: err.message }, 400);
    }
    console.error("PATCH /admin/purchases/:id failed", err);
    return c.json({ error: "internal_error", message: "failed to update purchase" }, 500);
  }
});

/**
 * DELETE /admin/purchases/:id
 * adminのみ。購入履歴の削除。削除した購入金額を必ず残額に再加算する
 * （01_architecture.md 4.2確定事項 / 02_security.md 確定方針G）。
 */
adminRoute.delete("/purchases/:id", async (c) => {
  const db = getDb();
  const facilityId = await resolveSoleFacilityId(db);
  if (!facilityId) {
    return c.json({ error: "not_found", message: "facility not found" }, 404);
  }
  const purchaseId = c.req.param("id");

  try {
    const balanceRef = db.doc(`facilities/${facilityId}/balance/current`);
    const purchaseRef = db.doc(`facilities/${facilityId}/purchases/${purchaseId}`);

    const result = await db.runTransaction(async (tx) => {
      const [balanceSnap, purchaseSnap] = await Promise.all([tx.get(balanceRef), tx.get(purchaseRef)]);

      if (!purchaseSnap.exists) {
        throw new NotFoundError("purchase not found");
      }

      const purchaseAmount = purchaseSnap.data()!.amount as number;
      const currentBalanceAmount = (balanceSnap.data()?.amount as number | undefined) ?? 0;
      // 削除時は必ず残額に再加算する（要件確定）
      const newBalanceAmount = currentBalanceAmount + purchaseAmount;
      assertValidAmount(newBalanceAmount, { fieldName: "resulting balance amount" });

      tx.delete(purchaseRef);
      tx.set(
        balanceRef,
        {
          amount: newBalanceAmount,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: "admin",
        },
        { merge: true },
      );

      return { balanceAmount: newBalanceAmount };
    });

    return c.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.json({ error: "not_found", message: err.message }, 404);
    }
    console.error("DELETE /admin/purchases/:id failed", err);
    return c.json({ error: "internal_error", message: "failed to delete purchase" }, 500);
  }
});
