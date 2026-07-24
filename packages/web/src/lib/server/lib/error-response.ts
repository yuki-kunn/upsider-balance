import type { Context } from "hono";
import { NotFoundError, ValidationError } from "./validation.js";
import { RateLimitError } from "./rate-limit.js";

/**
 * 各ルートのcatch節で発生しうるエラーを {error, message} + HTTPステータスに変換する
 * 共通ハンドラ。エラー種別ごとの分岐をルートファイルに重複させないための集約先
 * （tech-debt issue #9）。想定外のエラーは internal_error(500) にフォールバックする。
 */
export function respondWithError(c: Context, err: unknown, fallbackMessage: string) {
  if (err instanceof RateLimitError) {
    return c.json({ error: "rate_limited", message: err.message }, 429);
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: "not_found", message: err.message }, 404);
  }
  if (err instanceof ValidationError) {
    return c.json({ error: "bad_request", message: err.message }, 400);
  }
  console.error(fallbackMessage, err instanceof Error ? err.message : err);
  return c.json({ error: "internal_error", message: fallbackMessage }, 500);
}
