import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User
} from "firebase/auth";
import { readable } from "svelte/store";
import { auth } from "./firebase";

const FACILITY_EMAIL_DOMAIN = "login.upsider-balance.internal";

/** 施設IDを疑似メールアドレスに変換する（ユーザーには見せない内部実装） */
function facilityIdToEmail(facilityId: string): string {
  return `facility-${facilityId}@${FACILITY_EMAIL_DOMAIN}`;
}

/** adminIDを疑似メールアドレスに変換する（ユーザーには見せない内部実装） */
function adminIdToEmail(adminId: string): string {
  return `admin-${adminId}@${FACILITY_EMAIL_DOMAIN}`;
}

/** 施設ID・PASSでログインする */
export async function loginAsFacility(facilityId: string, password: string) {
  const email = facilityIdToEmail(facilityId);
  return signInWithEmailAndPassword(auth, email, password);
}

/** adminID・PASSでログインする */
export async function loginAsAdmin(adminId: string, password: string) {
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
