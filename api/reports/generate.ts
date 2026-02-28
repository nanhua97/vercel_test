import { methodNotAllowed, readJsonBody, sendError } from '../_lib/http.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    const body = readJsonBody<{
      client_name?: string;
      client_phone?: string;
      organs?: string[];
      constitutions?: string[];
    }>(req);

    const clientName = escapeHtml(body.client_name || 'Anonymous');
    const clientPhone = escapeHtml(body.client_phone || 'N/A');
    const organs = (body.organs || []).map((x) => escapeHtml(String(x))).join(' + ') || '未提供';
    const constitutions = (body.constitutions || []).map((x) => escapeHtml(String(x))).join(' + ') || '未提供';

    const html = `<!DOCTYPE html>
<html lang="zh-TW">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>中西醫整合營養調理報告</title>
    <style>
      body { font-family: "Noto Sans TC", "Microsoft JhengHei", sans-serif; margin: 24px; color: #1f2937; }
      .card { max-width: 900px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 16px; padding: 24px; }
      h1 { margin: 0 0 12px; color: #1e3a8a; }
      h2 { margin-top: 24px; color: #334155; }
      .meta { background: #f8fafc; border-radius: 12px; padding: 12px 16px; }
      .meta p { margin: 4px 0; }
      @media print {
        body { margin: 0; }
        .card { border: none; border-radius: 0; }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>&lt;Premium定制&gt; 中西醫整合營養調理指南</h1>
      <div class="meta">
        <p><strong>客戶姓名：</strong>${clientName}</p>
        <p><strong>客戶電話：</strong>${clientPhone}</p>
        <p><strong>臟腑判斷：</strong>${organs}</p>
        <p><strong>體質判斷：</strong>${constitutions}</p>
      </div>
      <h2>說明</h2>
      <p>此為可列印的簡版報告頁面。完整內容請在系統中使用 AI 報告區塊查看與保存。</p>
    </div>
    <script>
      window.onload = function () {
        setTimeout(function () { window.print(); }, 500);
      };
    </script>
  </body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (error) {
    sendError(res, error);
  }
}
