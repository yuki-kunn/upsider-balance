import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getStorage, type Storage } from "firebase-admin/storage";

/**
 * Firebase Admin SDK の初期化。
 * Cloud Functions for Firebase の実行環境では認証情報が自動注入されるため、
 * 引数なしの initializeApp() で動作する。
 * 複数回 import されても再初期化しないようガードする。
 */
function ensureApp() {
  if (getApps().length === 0) {
    initializeApp();
  }
}

let firestoreInstance: Firestore | undefined;
let authInstance: Auth | undefined;
let storageInstance: Storage | undefined;

export function getDb(): Firestore {
  ensureApp();
  if (!firestoreInstance) {
    firestoreInstance = getFirestore();
    // 未定義フィールドを無視して保存する（明示的にnullを使う設計のため念のため）
    firestoreInstance.settings({ ignoreUndefinedProperties: true });
  }
  return firestoreInstance;
}

export function getAdminAuth(): Auth {
  ensureApp();
  if (!authInstance) {
    authInstance = getAuth();
  }
  return authInstance;
}

export function getAdminStorage(): Storage {
  ensureApp();
  if (!storageInstance) {
    storageInstance = getStorage();
  }
  return storageInstance;
}
