import { GoogleGenAI, Type } from "@google/genai";
import { defineSecret } from "firebase-functions/params";

/**
 * Gemini APIキー。Firebase Secret Manager経由で参照する。
 * コード内にAPIキーを直書きしない（02_security.md 6章）。
 * `firebase functions:secrets:set GEMINI_API_KEY` で登録済みの前提。
 */
export const geminiApiKeySecret: ReturnType<typeof defineSecret> = defineSecret("GEMINI_API_KEY");

let client: GoogleGenAI | undefined;

/**
 * GoogleGenAIクライアントを遅延初期化する。
 * Secret Managerの値はランタイムの環境変数として注入されるため、
 * リクエストハンドラ内（Secretがbindされた後）で初めて呼び出すこと。
 */
function getGeminiClient(): GoogleGenAI {
  if (!client) {
    const apiKey = geminiApiKeySecret.value();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY secret is not configured");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export interface ReceiptAnalysisResult {
  amountCandidates: number[];
  storeNameCandidates: string[];
  itemCandidates: string[];
  raw: Record<string, unknown>;
}

const RECEIPT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    amountCandidates: {
      type: Type.ARRAY,
      items: { type: Type.NUMBER },
      description: "レシートから読み取れる合計金額の候補（円、整数）。確信度の高い順。",
    },
    storeNameCandidates: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "レシートから読み取れる店舗名の候補。",
    },
    itemCandidates: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "レシートに記載されている購入品目の候補（品目名のみ、価格は含めない）。",
    },
  },
  required: ["amountCandidates", "storeNameCandidates", "itemCandidates"],
} as const;

const RECEIPT_PROMPT = `あなたはレシート画像を解析するアシスタントです。
添付されたレシート画像から、以下の情報を抽出してください。
- amountCandidates: 合計金額の候補（円、整数のみ。カンマや円記号は含めない）
- storeNameCandidates: 店舗名の候補
- itemCandidates: 購入品目名の候補（価格は含めない）

読み取れない場合は空配列を返してください。数値は必ず整数にしてください。
レシート以外の画像や読み取り不能な場合もエラーにせず、可能な範囲で空配列を返してください。`;

/**
 * Gemini 2.5 Flashでレシート画像を解析する。
 * @param imageBytes 画像のバイナリデータ
 * @param mimeType 画像のMIMEタイプ（image/jpeg, image/png等）
 */
export async function analyzeReceiptImage(
  imageBytes: Buffer,
  mimeType: string,
): Promise<ReceiptAnalysisResult> {
  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { text: RECEIPT_PROMPT },
          {
            inlineData: {
              mimeType,
              data: imageBytes.toString("base64"),
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RECEIPT_RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini API returned an empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse Gemini response as JSON: ${(err as Error).message}`);
  }

  const obj = parsed as Record<string, unknown>;
  const amountCandidates = Array.isArray(obj.amountCandidates)
    ? obj.amountCandidates
        .map((v) => Math.round(Number(v)))
        .filter((v) => Number.isFinite(v))
    : [];
  const storeNameCandidates = Array.isArray(obj.storeNameCandidates)
    ? obj.storeNameCandidates.filter((v): v is string => typeof v === "string")
    : [];
  const itemCandidates = Array.isArray(obj.itemCandidates)
    ? obj.itemCandidates.filter((v): v is string => typeof v === "string")
    : [];

  return {
    amountCandidates,
    storeNameCandidates,
    itemCandidates,
    raw: obj,
  };
}
