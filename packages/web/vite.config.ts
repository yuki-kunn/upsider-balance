import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// 本番はFirebase Hostingのrewrites(/api/**)がCloud Functionsに転送するが、
// 開発サーバーではviteのproxyで同等の挙動を再現する。
export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
