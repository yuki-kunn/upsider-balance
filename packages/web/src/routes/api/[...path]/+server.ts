import type { RequestHandler } from "./$types";
import { app } from "$lib/server/app";

/**
 * Hono API（`packages/web/src/lib/server`）を SvelteKit の API Route に委譲する薄いラッパー。
 * Honoは標準Fetch APIベースなので、SvelteKitの RequestEvent からそのままFetch Requestを渡し、
 * 返ってきた Response をそのまま返せば動作する。
 */
const handle: RequestHandler = ({ request }) => app.fetch(request);

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const PUT = handle;
