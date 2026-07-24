import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Firebase Hosting は完全な静的配信のため、SPAフォールバックとして
    // すべての未知パスを index.html に解決させる（firebase.json の rewrites と対応）
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "index.html",
      precompress: false,
      strict: true
    })
  }
};

export default config;
