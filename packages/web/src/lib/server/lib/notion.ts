import { Client } from "@notionhq/client";

/**
 * 購入登録のたびにNotionデータベースへ1行（1ページ）追加する。
 * https://github.com/Asuma09/receipt-uploader のlib/notion.tsを移植したもの。
 *
 * Notion SDK v5はdata sourceモデルのため、
 *   database_id → data_source_id を取得 → そのスキーマを読む → ページ作成
 * の順で行う。プロパティ名は環境ごとに自由に付けられるよう、名前ではなく「型」で
 * 自動検出する（title / number / date / files の最初のプロパティを使う。同じ型が複数
 * ある場合は名前にキーワードを含む列を優先する）。
 */

let client: Client | undefined;

function getNotionClient(): Client {
  if (!client) {
    const token = process.env.NOTION_TOKEN;
    if (!token) {
      throw new Error("NOTION_TOKEN environment variable is not set");
    }
    client = new Client({ auth: token });
  }
  return client;
}

export type NotionReceiptRow = {
  imageUrl: string;
  amount: number;
  /** "YYYY-MM-DD" */
  date: string;
  storeName?: string | null;
  memo?: string | null;
};

/** @returns 作成したNotionページのID（削除時にaddReceiptRowToNotionと対応するページをアーカイブするために使う） */
export async function addReceiptRowToNotion({ imageUrl, amount, date, storeName, memo }: NotionReceiptRow): Promise<string> {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    throw new Error("NOTION_DATABASE_ID environment variable is not set");
  }

  const notion = getNotionClient();

  const db = await notion.databases.retrieve({ database_id: databaseId });
  const dataSources = "data_sources" in db ? db.data_sources : [];
  const dataSourceId = dataSources[0]?.id;
  if (!dataSourceId) {
    throw new Error("Notion database has no data source");
  }

  const ds = await notion.dataSources.retrieve({ data_source_id: dataSourceId });

  let titleName: string | undefined;
  let amountName: string | undefined;
  let dateName: string | undefined;
  let filesName: string | undefined;
  for (const [name, cfg] of Object.entries(ds.properties)) {
    if (cfg.type === "title") {
      titleName = name;
    } else if (cfg.type === "number") {
      if (!amountName || name.includes("金額")) amountName = name;
    } else if (cfg.type === "date") {
      if (!dateName || name.includes("日付") || name.includes("日時")) dateName = name;
    } else if (cfg.type === "files") {
      if (!filesName || name.includes("画像") || name.includes("レシート")) filesName = name;
    }
  }

  const titleText = storeName && storeName.trim().length > 0 ? `${storeName} ${date}` : `レシート ${date}`;

  const properties: Record<string, unknown> = {};
  if (titleName) {
    properties[titleName] = { title: [{ type: "text", text: { content: titleText } }] };
  }
  if (amountName) {
    properties[amountName] = { number: amount };
  }
  if (dateName) {
    properties[dateName] = { date: { start: date } };
  }
  if (filesName) {
    properties[filesName] = {
      files: [{ type: "external", name: "receipt.jpg", external: { url: imageUrl } }],
    };
  }

  const children: Record<string, unknown>[] = [
    {
      object: "block",
      type: "image",
      image: { type: "external", external: { url: imageUrl } },
    },
  ];
  if (memo && memo.trim().length > 0) {
    children.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: memo } }] },
    });
  }

  const page = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: dataSourceId },
    properties: properties as never,
    children: children as never,
  });

  return page.id;
}

/**
 * Notionページをアーカイブ（ゴミ箱へ移動）する。購入履歴の削除に連動して呼ぶ。
 * Notion API上、ページの完全削除はできず「in_trash: true」でのアーカイブが実質的な削除操作となる。
 * 対象ページが既に手動で削除・アーカイブ済みの場合もエラーにせず正常終了とする
 * （削除操作の冪等性を保つため）。
 */
export async function archiveReceiptRowInNotion(pageId: string): Promise<void> {
  const notion = getNotionClient();
  try {
    await notion.pages.update({ page_id: pageId, in_trash: true } as never);
  } catch (err) {
    const notionErr = err as { code?: string; status?: number };
    // 対象ページが既に存在しない/アクセス不可の場合は冪等に成功扱いにする
    if (notionErr.code === "object_not_found" || notionErr.status === 404) {
      return;
    }
    throw err;
  }
}
