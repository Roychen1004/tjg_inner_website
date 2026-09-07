import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // 與 tsconfig.json 的 paths 對應。tsc 看 tsconfig，Rollup 看這裡，兩邊都要設
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // 8GB 主機的約束：初始 JS gzip 後須 < 200KB
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
        },
      },
    },
    chunkSizeWarningLimit: 250,
  },
  server: {
    host: true,
    port: 5173,
    // 這台 dev server 前面通常還有一層 nginx（:30080，見 docker-compose.override.yml）。
    // HMR 的 websocket 是瀏覽器直接連的，所以要告訴它「連回你看到的那個埠」，
    // 否則它會固執地連 5173——症狀是頁面正常、但改了檔案畫面不動。
    hmr: { clientPort: Number(process.env.VITE_HMR_CLIENT_PORT ?? 5173) },
    proxy: {
      // 直連 dev server（:5173／:30173）時把 /api 轉出去。
      // 預設打 nginx 而不是 api:8000——附件下載走 X-Accel-Redirect，
      // 少了 nginx 會下載到 0 bytes 而且不會報錯。
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:30080",
        // 不改 Host：讓 Django 看到瀏覽器原本的主機名，
        // ALLOWED_HOSTS / CSRF 的設定才對得上
        changeOrigin: false,
      },
    },
  },
});
