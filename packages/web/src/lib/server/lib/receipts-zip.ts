// archiver v8はESMネイティブで、v7以前のファクトリ関数archiver('zip', opts)ではなく
// クラスベースAPI(new ZipArchive(opts))になっている。
import { ZipArchive } from "archiver";
import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { getReceiptImageUrlFromNotion } from "./notion.js";
import { formatMonthLabelForFile } from "./date-format.js";

/** 1つのフォルダに含めるレシート件数。これを超える場合はpart単位でzip内をフォルダ分けする。 */
const RECEIPTS_PER_FOLDER = 10;

/**
 * 指定月にNotionへ送信済み（notionSyncStatus === "synced"）の購入を対象に、
 * レシート画像をNotionから取得してひとつのzipにまとめる。
 * このアプリのFirebase Storageではなく、あえてNotion側に実際に登録されている画像を
 * 正とする（Notionが施設の実運用上のレシート台帳になっている想定のため）。
 *
 * 合計件数がRECEIPTS_PER_FOLDER（10件）を超える場合、zip内をpart1/, part2/, …の
 * サブフォルダに10件ずつ区切って格納する（1フォルダあたりの枚数が多すぎて
 * 確認しづらくなるのを避けるための実運用上の要件）。10件以下の場合はフォルダ分けせず
 * これまで通りzip直下にファイルを並べる。
 *
 * Vercel Serverless Functionsのレスポンスとして返しやすいよう、ストリームではなく
 * 完成したzipをBufferとしてメモリ上に構築する（月あたりのレシート枚数は実運用上
 * 数十件程度を想定しており、サイズ的に問題にならない）。
 *
 * @returns zipのBufferと、実際に含められた件数・スキップされた件数
 */
export async function buildMonthlyReceiptsZip(
  db: Firestore,
  facilityId: string,
  year: number,
  month: number,
): Promise<{ buffer: Buffer; includedCount: number; skippedCount: number; zipFileName: string }> {
  const rangeStart = new Date(year, month - 1, 1);
  const rangeEnd = new Date(year, month, 1);

  // notionSyncStatusの等価条件はここでは付けず、purchasedAtの範囲のみでクエリする
  // （既存の月別履歴取得と同じ単一フィールド範囲クエリのため追加の複合インデックスが不要。
  // synced以外の除外はアプリケーション側で行う。月間の件数は実運用上数十件程度のため
  // パフォーマンス上の問題にはならない）。
  const snap = await db
    .collection(`facilities/${facilityId}/purchases`)
    .where("purchasedAt", ">=", Timestamp.fromDate(rangeStart))
    .where("purchasedAt", "<", Timestamp.fromDate(rangeEnd))
    .orderBy("purchasedAt", "asc")
    .get();

  let skippedCount = 0;
  const fetchedFiles: { fileName: string; buffer: Buffer }[] = [];

  // archiverへの追加前に全件のNotion画像を集める（件数が判明してからでないと
  // part分けのフォルダ番号が決められないため）。Notion取得はシーケンシャルに行う
  // （並列化すると1件あたりのAPI呼び出し数は増やせるが、Notion APIのレート制限を
  // 踏まえて安全側に倒す。月あたりの件数は実運用上多くても数十件程度を想定）。
  for (const doc of snap.docs) {
    const data = doc.data();
    const notionSyncStatus = data.notionSyncStatus as string | undefined;
    // Notion未送信・送信失敗の購入はzip対象外（Notionに実際に画像が登録されていないため）。
    // 一覧取得時にFirestore側でフィルタしていないので、ここでスキップする。
    if (notionSyncStatus !== "synced") {
      continue;
    }
    const notionPageId = data.notionPageId as string | null | undefined;
    if (!notionPageId) {
      skippedCount += 1;
      continue;
    }

    try {
      const imageUrl = await getReceiptImageUrlFromNotion(notionPageId);
      if (!imageUrl) {
        skippedCount += 1;
        continue;
      }

      const res = await fetch(imageUrl);
      if (!res.ok || !res.body) {
        skippedCount += 1;
        continue;
      }
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const purchasedAtDate = (data.purchasedAt as Timestamp).toDate();
      const dateLabel = purchasedAtDate.toISOString().slice(0, 10);
      const storeName = (data.storeName as string | null) ?? "レシート";
      const safeStoreName = sanitizeFileNamePart(storeName);
      const extension = guessExtensionFromContentType(res.headers.get("content-type")) ?? "jpg";
      const fileName = `${dateLabel}_${safeStoreName}_${doc.id.slice(0, 6)}.${extension}`;

      fetchedFiles.push({ fileName, buffer });
    } catch (err) {
      console.error("failed to fetch receipt image for zip", doc.id, err instanceof Error ? err.message : err);
      skippedCount += 1;
    }
  }

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));
  const archiveFinished = new Promise<void>((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });

  // 10件を超える場合のみpart1/, part2/, …のサブフォルダに区切る。
  // 10件以下ならフォルダ分けせずzip直下に並べる（従来通りの見え方を維持する）。
  const needsFolderSplit = fetchedFiles.length > RECEIPTS_PER_FOLDER;
  fetchedFiles.forEach(({ fileName, buffer }, index) => {
    const entryName = needsFolderSplit
      ? `part${Math.floor(index / RECEIPTS_PER_FOLDER) + 1}/${fileName}`
      : fileName;
    archive.append(buffer, { name: entryName });
  });

  await archive.finalize();
  await archiveFinished;

  const includedCount = fetchedFiles.length;
  const zipFileName = `${formatMonthLabelForFile(year, month)}_レシート.zip`;
  return { buffer: Buffer.concat(chunks), includedCount, skippedCount, zipFileName };
}

function sanitizeFileNamePart(value: string): string {
  // zipエントリ名・ファイル名として問題になりうる文字を除去する
  return value.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 30) || "レシート";
}

function guessExtensionFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  if (contentType.includes("jpeg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("heic")) return "heic";
  return null;
}
