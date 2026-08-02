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
    proxy: {
      // 本機開發時把 API 轉給 Django
      "/api": { target: "http://localhost:30800", changeOrigin: true },
    },
  },
});
