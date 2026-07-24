import type { Firestore } from "firebase-admin/firestore";
import type { AuthUser } from "../middleware/auth.js";

/**
 * 単一施設運用（00_requirements.md 2章）のため、admin ログイン時は
 * facilities コレクションの唯一のドキュメントを解決する。
 * 将来マルチテナント化する場合はこの関数を admin 用のクエリパラメータ受け取りに置き換える。
 */
export async function resolveSoleFacilityId(db: Firestore): Promise<string | null> {
  const snap = await db.collection("facilities").limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

/**
 * リクエストの authUser から対象施設IDを解決する共通ヘルパー。
 * facility ロールは Custom Claims の facilityId をそのまま使う（改ざん不可）。
 * admin ロールは Custom Claims に facilityId を持たないため resolveSoleFacilityId で解決する。
 */
export async function resolveFacilityIdForUser(authUser: AuthUser, db: Firestore): Promise<string | null> {
  if (authUser.role === "facility") return authUser.facilityId;
  return resolveSoleFacilityId(db);
}
