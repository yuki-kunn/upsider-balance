import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import type { UserRole } from "@upsider-balance/shared";
import { getAdminAuth } from "../lib/firestore.js";

/**
 * 認証済みユーザー情報。verifyIdToken 通過後に Hono Context にセットされる。
 * role/facilityId は Firebase Auth の Custom Claims から取得する
 * （02_security.md 3.1: ロール判定は必ず Custom Claims で行う）。
 */
export interface AuthUser {
  uid: string;
  role: UserRole;
  /** role === "facility" の場合のみ設定される */
  facilityId: string | null;
}

type Variables = {
  authUser: AuthUser;
};

export type AppEnv = { Variables: Variables };

/**
 * Authorization: Bearer <idToken> を検証し、Context に authUser をセットするミドルウェア。
 * 検証に失敗した場合は 401 を返す。
 */
export const verifyIdToken = createMiddleware<AppEnv>(async (c: Context<AppEnv>, next: Next) => {
  const authHeader = c.req.header("Authorization") ?? c.req.header("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized", message: "Authorization header is missing" }, 401);
  }

  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) {
    return c.json({ error: "unauthorized", message: "ID token is missing" }, 401);
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const role = decoded.role as UserRole | undefined;

    if (role !== "facility" && role !== "admin") {
      return c.json({ error: "forbidden", message: "role claim is missing or invalid" }, 403);
    }

    const facilityId = role === "facility" ? ((decoded.facilityId as string | undefined) ?? null) : null;
    if (role === "facility" && !facilityId) {
      return c.json({ error: "forbidden", message: "facilityId claim is missing" }, 403);
    }

    const authUser: AuthUser = { uid: decoded.uid, role, facilityId };
    c.set("authUser", authUser);
    await next();
  } catch (err) {
    console.error("verifyIdToken failed", err);
    return c.json({ error: "unauthorized", message: "invalid or expired ID token" }, 401);
  }
});

/**
 * ロールチェックミドルウェア。verifyIdToken の後段で使用すること。
 * "facility" | "admin" のいずれかを許可ロールとして複数指定可能
 * （例: requireRole("facility", "admin")）。
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return createMiddleware<AppEnv>(async (c: Context<AppEnv>, next: Next) => {
    const authUser = c.get("authUser");
    if (!authUser || !allowedRoles.includes(authUser.role)) {
      return c.json({ error: "forbidden", message: "insufficient role" }, 403);
    }
    await next();
  });
}
