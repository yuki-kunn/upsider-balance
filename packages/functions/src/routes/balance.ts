import { Hono } from "hono";
import type { Balance } from "@upsider-balance/shared";
import type { AppEnv } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { getDb } from "../lib/firestore.js";
import { resolveFacilityIdForUser } from "../lib/facility.js";

export const balanceRoute = new Hono<AppEnv>();

/**
 * GET /balance
 * 施設 or admin。facilityId は Custom Claims から取得する（施設はクエリ改ざん不可）。
 * admin の場合は Custom Claims に facilityId を持たないため、単一施設運用の前提で
 * facilities コレクションから唯一の施設を解決する。
 */
balanceRoute.get("/", requireRole("facility", "admin"), async (c) => {
  const authUser = c.get("authUser");
  const db = getDb();

  const facilityId = await resolveFacilityIdForUser(authUser, db);

  if (!facilityId) {
    return c.json({ error: "not_found", message: "facility not found" }, 404);
  }

  const snap = await db.doc(`facilities/${facilityId}/balance/current`).get();
  if (!snap.exists) {
    return c.json({ error: "not_found", message: "balance not initialized" }, 404);
  }

  const data = snap.data() as Omit<Balance, "updatedAt"> & { updatedAt: FirebaseFirestore.Timestamp };
  const balance: Balance = {
    amount: data.amount,
    updatedBy: data.updatedBy,
    updatedAt: data.updatedAt?.toMillis?.() ?? Date.now(),
  };

  return c.json({ facilityId, balance });
});
