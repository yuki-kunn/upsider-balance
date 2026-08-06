import { ref, uploadBytes } from "firebase/storage";
import { storage, auth } from "./firebase";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class ReceiptUploadError extends Error {}

/**
 * レシート画像をFirebase Storageに直接アップロードする（クライアント→Storage直、01_architecture.md 5章）。
 * 保存先パスは storage.rules / receipts.ts と同じ規約: facilities/{facilityId}/receipts/{fileName}
 *
 * facilityIdの解決方法:
 * - 施設アカウントでログイン中: Custom Claimsのfacilityidをそのまま使う（クエリ改ざん不可）
 * - adminアカウントでログイン中: Custom Claimsにfacilityidを持たないため、呼び出し側が
 *   GET /balance 等のレスポンスから取得したfacilityIdを明示的に渡す必要がある
 *   （storage.rulesはadminロールでの書き込みも許可している）
 */
export async function uploadReceiptImage(file: File, explicitFacilityId?: string): Promise<string> {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new ReceiptUploadError("対応していない画像形式です（JPEG/PNG/WebP/HEICのみ）");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ReceiptUploadError("画像サイズが10MBを超えています");
  }

  const user = auth.currentUser;
  if (!user) {
    throw new ReceiptUploadError("ログインしていません");
  }
  const tokenResult = await user.getIdTokenResult();
  const claimFacilityId = tokenResult.claims.facilityId;
  const facilityId =
    typeof claimFacilityId === "string" && claimFacilityId.length > 0 ? claimFacilityId : explicitFacilityId;
  if (typeof facilityId !== "string" || facilityId.length === 0) {
    throw new ReceiptUploadError("施設情報を取得できませんでした");
  }

  const extension = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
  const fileName = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const path = `facilities/${facilityId}/receipts/${fileName}`;

  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });

  return path;
}
