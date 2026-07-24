import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * Gemini API呼び出しのコスト濫用対策（02_security.md 6章）。
 * 施設ごとに1日あたりの呼び出し回数をFirestoreでカウントし、上限を超えたら拒否する。
 * 低コスト運用が要件のため、明らかな異常連打を防ぐソフトリミットとして機能させる
 * （通常のスタッフ利用でこの上限に達することは想定していない）。
 */
const DAILY_LIMIT = 50;

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間（JST, UTC+9）基準のYYYY-MM-DDを返す。単一施設が日本国内で運用される前提。 */
function todayKey(): string {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 施設の当日分のGemini呼び出しカウントをインクリメントし、上限を超えていればエラーを投げる。
 * カウンタは geminiUsage/{facilityId}_{YYYY-MM-DD} に保持する（クライアントからは読み書き不可）。
 */
export async function assertGeminiRateLimit(db: Firestore, facilityId: string): Promise<void> {
  const docId = `${facilityId}_${todayKey()}`;
  const ref = db.doc(`geminiUsage/${docId}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = (snap.data()?.count as number | undefined) ?? 0;

    if (count >= DAILY_LIMIT) {
      throw new RateLimitError(`1日あたりのレシート解析回数の上限（${DAILY_LIMIT}回）に達しました`);
    }

    tx.set(
      ref,
      {
        facilityId,
        date: todayKey(),
        count: count + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}
