import adapter from "@sveltejs/adapter-vercel";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // API Routes (+server.ts) でHono APIをホストするため、SSR/サーバーサイド実行が必要。
    // Vercelにデプロイするため adapter-vercel を使用する。
    adapter: adapter()
  }
};

export default config;
