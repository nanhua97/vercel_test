# 養生品牌訂單與預約管理系統

目前版本為純前端架構：
- 前端：Vite + React（輸出到 `dist`）
- AI：瀏覽器直接呼叫 Gemini
- 報告：前端渲染 + 前端匯出 PDF

## 本地開發

```bash
npm install
cp .env.example .env
npm run dev
```

預設開在 [http://localhost:5173](http://localhost:5173)。

## 環境變數

請在 `.env` 設定：
- `VITE_GEMINI_API_KEY`（必填）
- `VITE_GEMINI_MODEL`（選填，預設 `gemini-2.5-flash`）
- `VITE_GEMINI_MAX_OUTPUT_TOKENS`（選填，預設 `10000`）

## 建置與預覽

```bash
npm run build
npm run preview
```

## 部署到 Vercel

1. 匯入專案到 Vercel。
2. 在專案環境變數加入 `VITE_GEMINI_API_KEY`（以及需要的選填變數）。
3. Deploy。

## 注意事項

- 本專案採前端直連 Gemini，`VITE_GEMINI_API_KEY` 會出現在前端資產中，請務必搭配 Google Cloud 限額與金鑰限制策略。
- 由於不再依賴 Vercel Function 生成報告，AI 生成流程不受 Vercel Function 執行時長限制。
