import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getStorage, type Storage } from "firebase-admin/storage";

/**
 * Firebase Admin SDK の初期化。
 * Vercel環境では認証情報の自動注入が無いため、サービスアカウント鍵をJSON文字列の
 * 環境変数 `FIREBASE_SERVICE_ACCOUNT_KEY` として渡し、cert() で明示的に初期化する。
 * 複数回 import されても再初期化しないようガードする。
 */
function ensureApp() {
  if (getApps().length === 0) {
    const serviceAccountKeyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKeyJson) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set");
    }

    let raw: { project_id?: string; client_email?: string; private_key?: string };
    try {
      raw = JSON.parse(serviceAccountKeyJson);
    } catch (err) {
      throw new Error(`Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY as JSON: ${(err as Error).message}`);
    }

    // ダウンロードしたサービスアカウント鍵JSONはsnake_caseのため、
    // firebase-admin の ServiceAccount 型（camelCase）に変換する。
    const serviceAccount = {
      projectId: raw.project_id,
      clientEmail: raw.client_email,
      privateKey: raw.private_key,
    };

    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId,
    });
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
