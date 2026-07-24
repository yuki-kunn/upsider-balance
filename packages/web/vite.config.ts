import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// /api/** はSvelteKit自身のAPI Route (routes/api/[...path]/+server.ts) が処理するため、
// 開発サーバーでも外部へのproxyは不要（Vercel移行前はCloud Functionsへのproxyが必要だった）。
export default defineConfig({
  plugins: [sveltekit()]
});
