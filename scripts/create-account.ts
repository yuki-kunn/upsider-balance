/**
 * 施設アカウント / adminアカウントのセットアップCLI。
 *
 * 施設ID/adminIDを疑似メールアドレスに変換してFirebase Authenticationにユーザーを作成し、
 * Custom Claims（role, facilityId）を付与する。あわせてFirestoreに対応するドキュメント
 * （facilities/{facilityId} または admins/{adminId}）を作成する。
 * 施設アカウント作成時は balance/current も初期値0で作成する（admin側で後から金額を設定する）。
 *
 * セルフサインアップは提供しないため、アカウント発行は本スクリプト経由のみで行う
 * （02_security.md 2.1 / 01_architecture.md 2.2）。
 *
 * 使い方:
 *   pnpm --filter @upsider-balance/functions exec tsx ../../scripts/create-account.ts facility <facilityId> <password> [displayName]
 *   pnpm --filter @upsider-balance/functions exec tsx ../../scripts/create-account.ts admin <adminId> <password>
 *
 * エミュレータに対して実行する場合は、実行前に以下の環境変数を設定すること:
 *   export FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
 *   export FIRESTORE_EMULATOR_HOST=localhost:8080
 */
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function initApp() {
  // GOOGLE_APPLICATION_CREDENTIALS が指すサービスアカウントJSONを明示的に読み込む。
  // 環境変数だけの自動検出はローカル実行時にprojectIdを解決できないことがあるため。
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsPath) {
    const serviceAccount = JSON.parse(readFileSync(credentialsPath, "utf8"));
    initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
    return;
  }
  // エミュレータ実行時など、認証情報が環境側で自動注入される場合はそのまま初期化する。
  initializeApp();
}

const FACILITY_EMAIL_DOMAIN = "facility.upsider-balance.local";
const ADMIN_EMAIL_DOMAIN = "admin.upsider-balance.local";

type Role = "facility" | "admin";

function toEmail(role: Role, id: string): string {
  const domain = role === "facility" ? FACILITY_EMAIL_DOMAIN : ADMIN_EMAIL_DOMAIN;
  return `${id}@${domain}`;
}

async function main() {
  const [role, id, password, displayName] = process.argv.slice(2) as [Role, string, string, string | undefined];

  if (role !== "facility" && role !== "admin") {
    console.error('第1引数は "facility" または "admin" を指定してください');
    process.exitCode = 1;
    return;
  }
  if (!id || !password) {
    console.error("使い方: create-account.ts <facility|admin> <id> <password> [displayName]");
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("PASSは8文字以上にしてください（02_security.md 2.2）");
    process.exitCode = 1;
    return;
  }

  initApp();
  const auth = getAuth();
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });

  const email = toEmail(role, id);

  const user = await auth.createUser({
    email,
    password,
    displayName: displayName ?? id,
  });

  const claims = role === "facility" ? { role: "facility", facilityId: id } : { role: "admin" };
  await auth.setCustomUserClaims(user.uid, claims);

  if (role === "facility") {
    const facilityRef = db.doc(`facilities/${id}`);
    await facilityRef.set({
      name: displayName ?? id,
      loginId: id,
      authUid: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const balanceRef = db.doc(`facilities/${id}/balance/current`);
    const balanceSnap = await balanceRef.get();
    if (!balanceSnap.exists) {
      await balanceRef.set({
        amount: 0,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "admin",
      });
    }
  } else {
    await db.doc(`admins/${id}`).set({
      loginId: id,
      authUid: user.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  console.log(`作成完了: role=${role} id=${id} uid=${user.uid} email=${email}`);
}

main().catch((err) => {
  console.error("アカウント作成に失敗しました:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
