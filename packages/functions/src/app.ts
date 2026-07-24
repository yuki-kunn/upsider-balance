import { Hono } from "hono";
import type { AppEnv } from "./middleware/auth.js";
import { verifyIdToken } from "./middleware/auth.js";
import { balanceRoute } from "./routes/balance.js";
import { purchasesRoute } from "./routes/purchases.js";
import { adminRoute } from "./routes/admin.js";
import { receiptsRoute } from "./routes/receipts.js";

/**
 * Honoアプリ本体。ベースパスは Firebase Hosting の rewrites (`/api/**`) 側で
 * 吸収されるため、ここでは `/` を起点にルーティングする
 * （01_architecture.md 4章）。
 */
export const app = new Hono<AppEnv>();

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
