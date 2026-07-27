import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User
} from "firebase/auth";
import { readable } from "svelte/store";
import { facilityIdToEmail, adminIdToEmail } from "@upsider-balance/shared";
import { auth } from "./firebase";

/**
 * Firebase Authはブラウザ1つにつき1ユーザーしか保持できないため、同一ブラウザで
 * 施設・adminを同時ログイン状態にすることはできない。既に別ロールでログイン済みの
 * 場合は、混乱を避けるため明示的にログアウトしてから新しいロールでログインし直す
 * （2026-07-25: 「施設情報を取得できませんでした」という分かりにくいエラーの原因になっていたため）。
 */
async function ensureNoOtherRoleSignedIn(expectedRole: "facility" | "admin") {
  const current = auth.currentUser;
  if (!current) return;
  const claims = await current.getIdTokenResult();
  if (claims.claims.role !== expectedRole) {
    await signOut(auth);
  }
}

/** 施設ID・PASSでログインする */
export async function loginAsFacility(facilityId: string, password: string) {
  await ensureNoOtherRoleSignedIn("facility");
  const email = facilityIdToEmail(facilityId);
  return signInWithEmailAndPassword(auth, email, password);
}

/** adminID・PASSでログインする */
export async function loginAsAdmin(adminId: string, password: string) {
  await ensureNoOtherRoleSignedIn("admin");
  const email = adminIdToEmail(adminId);
  return signInWithEmailAndPassword(auth, email, password);
}

/** ログアウトする */
export async function logout() {
  return signOut(auth);
}

/** 現在のログイン状態を監視するstore */
export const currentUser = readable<User | null | undefined>(undefined, (set) => {
  return onAuthStateChanged(auth, (user) => {
    set(user);
  });
});
