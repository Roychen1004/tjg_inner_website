# ── 建置期：把 React 編譯成靜態檔 ─────────────────────────────────
# Node 只存在於這一層，最終映像完全沒有 Node 程序（8GB 主機的關鍵）
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# ── 執行期：nginx 只負責把檔案丟出去 ──────────────────────────────
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
