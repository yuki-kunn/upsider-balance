import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User
} from "firebase/auth";
import { readable } from "svelte/store";
import { facilityIdToEmail, adminIdToEmail } from "@upsider-balance/shared";
import { auth } from "./firebase";

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
