import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { addReceiptRowToNotion, archiveReceiptRowInNotion } from "./notion.js";
import { getReceiptImageSignedUrl } from "./storage-url.js";

/**
 * 1件の購入（Firestoreドキュメント）をNotionへ同期する。
 * レシート画像が無い購入は同期対象外（notSynced）として扱う。
 * 送信の成否に関わらずpurchaseドキュメントのnotionSyncStatus/notionSyncErrorを更新するため、
 * 呼び出し側は結果を待たずレスポンスを返してよい（購入登録自体をNotion送信の成否で
 * 失敗させないため。失敗時はadmin画面から再送信できる）。
 */
export async function syncPurchaseToNotion(
  db: Firestore,
  facilityId: string,
  purchaseId: string,
  purchase: {
    amount: number;
    storeName: string | null;
    memo: string | null;
    purchasedAt: Timestamp;
    receiptImagePath: string | null;
  },
): Promise<{ notionSyncStatus: "notSynced" | "synced" | "failed"; notionSyncError: string | null }> {
  const purchaseRef = db.doc(`facilities/${facilityId}/purchases/${purchaseId}`);

  if (!purchase.receiptImagePath) {
    await purchaseRef.set({ notionSyncStatus: "notSynced", notionSyncError: null }, { merge: true });
    return { notionSyncStatus: "notSynced", notionSyncError: null };
  }

  try {
    const imageUrl = await getReceiptImageSignedUrl(purchase.receiptImagePath);
    const dateStr = purchase.purchasedAt.toDate().toISOString().slice(0, 10);
    const notionPageId = await addReceiptRowToNotion({
      imageUrl,
      amount: purchase.amount,
      date: dateStr,
      storeName: purchase.storeName,
      memo: purchase.memo,
    });
    await purchaseRef.set(
      { notionSyncStatus: "synced", notionSyncError: null, notionPageId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { notionSyncStatus: "synced", notionSyncError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("failed to sync purchase to Notion", purchaseId, message);
    await purchaseRef.set(
      { notionSyncStatus: "failed", notionSyncError: message, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { notionSyncStatus: "failed", notionSyncError: message };
  }
}

/**
 * Notionに送信済みの購入を削除する際、対応するNotionページもアーカイブ（ゴミ箱行き）にする。
 * notionPageIdが無い（そもそも送信していない/送信に失敗している）場合は何もしない。
 * ここでの失敗はFirestore側の購入削除をブロックしない（呼び出し側でtry/catchして
 * ログのみ残す想定。Notion側の削除だけ失敗しても、Firestore上の購入記録は削除確定させる）。
 */
export async function unsyncPurchaseFromNotion(notionPageId: string | null | undefined): Promise<void> {
  if (!notionPageId) return;
  await archiveReceiptRowInNotion(notionPageId);
}
