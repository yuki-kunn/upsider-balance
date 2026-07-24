import { getRequestListener } from "@hono/node-server";
import { onRequest } from "firebase-functions/v2/https";
import { app } from "./app.js";
import { geminiApiKeySecret } from "./lib/gemini.js";

/**
 * Hono アプリを Cloud Functions for Firebase の単一HTTPSエントリポイントとして export する
 * （01_architecture.md 1章・6章: `export const api = onRequest(honoApp)`）。
 *
 * - minInstances: 0 を明示し、アイドル時課金ゼロを維持する（コスト最小化要件）。
 * - secrets に GEMINI_API_KEY を指定し、Secret Manager経由でランタイムに注入する
 *   （receipts.ts が呼び出す Gemini API 用。02_security.md 6章）。
 *
 * @hono/node-server の getRequestListener で Hono の Fetch API ベースの app.fetch を
 * Cloud Functions (Node.js) が期待する Express 互換の (req, res) ハンドラに変換する。
 */
const requestListener = getRequestListener(app.fetch);

export const api = onRequest(
  {
    minInstances: 0,
    secrets: [geminiApiKeySecret],
    region: "asia-northeast1",
  },
  (req, res) => {
    requestListener(req, res);
  },
);
