# 養生品牌訂單與預約管理系統

這個版本已改為可直接部署到 Vercel：
- 前端：Vite + React（輸出到 `dist`）
- 後端：Vercel Serverless Functions（`api/*`）
- AI：Gemini 呼叫已移到後端（不再暴露 API Key 到前端）
- 資料儲存：
  - 推薦：Vercel KV（可持久化）
  - 退化：記憶體儲存（可運作但不持久）

## 一键部署到 Vercel

1. 將專案推到 GitHub（或你現有 Git 倉庫）。
2. 在 Vercel 匯入這個專案（Import Project）。
3. 在 Vercel 專案設定加入環境變數：
   - `GEMINI_API_KEY`（必填）
   - `GEMINI_MODEL`（選填，預設 `gemini-2.5-flash`）
4. 建議在 Vercel 連接 KV（Storage -> KV），讓系統資料可持久化。
   - 連接後會自動提供：`KV_REST_API_URL`、`KV_REST_API_TOKEN`
5. 點擊 Deploy。

## 本地開發

### 方式 A：維持現有本地後端（Express + SQLite）
```bash
npm install
cp .env.example .env
npm run dev
```
預設開在 [http://localhost:3000](http://localhost:3000)。

### 方式 B：模擬 Vercel Functions
```bash
npm install
npx vercel dev
```

## 建置

```bash
npm run build
```

## 主要 API

- `GET /api/clients`
- `GET /api/logs/:userId`
- `POST /api/logs`
- `GET /api/reports`
- `POST /api/reports/save`
- `POST /api/reports/ai-generate`
- `POST /api/reports/generate`（回傳可列印 HTML）

## 注意事項

- 若未配置 KV，雲端部署仍可運作，但資料在實例重啟/切換後可能遺失。
- `GEMINI_API_KEY` 只在後端使用；前端已不再注入該金鑰。
- 若你需要在本地開發走代理，設定 `APP_ENV=dev` 並填入 `HTTPS_PROXY`/`HTTP_PROXY`；後端 Gemini 請求會在 dev 模式強制走代理。
