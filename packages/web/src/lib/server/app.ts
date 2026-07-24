import { Hono } from "hono";
import type { AppEnv } from "./middleware/auth.js";
import { verifyIdToken } from "./middleware/auth.js";
import { balanceRoute } from "./routes/balance.js";
import { purchasesRoute } from "./routes/purchases.js";
import { adminRoute } from "./routes/admin.js";
import { receiptsRoute } from "./routes/receipts.js";

/**
 * Honoアプリ本体。SvelteKitの `routes/api/[...path]/+server.ts` が
 * `/api/**` のリクエストをそのまま `app.fetch` に渡すため、`basePath("/api")` で
 * プレフィックスを吸収してから各ルートを `/` 起点にマウントする。
 */
export const app = new Hono<AppEnv>().basePath("/api");

// すべての /api/** エンドポイントでIDトークンを検証する（02_security.md 2.2）。
// ロール別の追加チェックは各ルート側の requireRole ミドルウェアで行う。
app.use("*", verifyIdToken);

app.route("/balance", balanceRoute);
app.route("/purchases", purchasesRoute);
app.route("/admin", adminRoute);
app.route("/receipts", receiptsRoute);

app.onError((err, c) => {
  console.error("Unhandled error", err);
  return c.json({ error: "internal_error", message: "unexpected error" }, 500);
});

app.notFound((c) => c.json({ error: "not_found", message: "route not found" }, 404));
