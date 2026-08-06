import { getAdminStorage } from "./firestore.js";

/**
 * Firebase Storage上のレシート画像に対して、Notionページに埋め込むための
 * 長期間有効な署名付きURLを発行する。バケット自体は非公開のままで、
 * URLを知っている人だけがアクセスできる（02_security.mdの方針に沿う）。
 * 有効期限は実質的な失効を避けるため十分長く取る（10年）。
 */
export async function getReceiptImageSignedUrl(receiptImagePath: string): Promise<string> {
  const bucket = getAdminStorage().bucket();
  const file = bucket.file(receiptImagePath);
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
  });
  return url;
}
