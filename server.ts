import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { setupDevProxyForGemini } from './api/_lib/devProxy.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

setupDevProxyForGemini();

const db = new Database('tcm_service.db');

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    role TEXT CHECK(role IN ('agent', 'client'))
  );

  CREATE TABLE IF NOT EXISTS daily_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    date TEXT,
    breakfast_img TEXT,
    lunch_img TEXT,
    dinner_img TEXT,
    sleep_start TEXT,
    sleep_end TEXT,
    water_cups INTEGER,
    coffee BOOLEAN,
    notes TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT,
    client_phone TEXT,
    diagnosis TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed initial data
const seed = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
if (seed.count === 0) {
  db.prepare('INSERT INTO users (name, role) VALUES (?, ?)').run('CS Agent Amy', 'agent');
  db.prepare('INSERT INTO users (name, role) VALUES (?, ?)').run('Client John Doe', 'client');
}

// Knowledge Base Mapping based on reference document
const KNOWLEDGE_BASE: any = {
  organs: {
    '心 (Heart)': {
      western_analysis: '體液滯留（鈉鉀失衡）、潛在慢性發炎、神經遞質不穩定（缺鎂/B群）導致焦慮淺眠。',
      western_strategy: '1. <strong>高鉀排水：</strong> 利用蔬菜與特定食材的高鉀離子對抗鈉，將多餘水分排出。<br>2. <strong>抗發炎護心：</strong> 導入 Omega-3 與植化素，保護血管內皮。<br>3. <strong>神經穩定：</strong> 補充鎂、鈣、B群豐富食材以安神助眠。',
      tcm_analysis: '心陽不振（馬達無力），脾虛濕盛（除濕機故障），導致水濕內停，上擾心神。',
      tcm_strategy: '1. <strong>溫陽化濕：</strong> 嚴禁寒涼，用溫熱食材恢復脾胃運化功能，像太陽曬乾濕地。<br>2. <strong>淡滲利水：</strong> 運用四神、薏仁等「淡味」食材，溫和地疏通水道。<br>3. <strong>養心安神：</strong> 以紅色食材與寧心藥材滋養心血，使心神安定。'
    },
    '肝 (Liver)': {
      western_analysis: '肝臟解毒壓力大，可能伴隨氧化應激與代謝緩慢。',
      western_strategy: '1. <strong>強化解毒：</strong> 補充十字花科蔬菜。<br>2. <strong>抗氧化：</strong> 攝取維生素C與E級。',
      tcm_analysis: '肝氣鬱結，氣機不暢，影響脾胃運化。',
      tcm_strategy: '1. <strong>疏肝理氣：</strong> 運用薄荷、玫瑰花。<br>2. <strong>養血柔肝：</strong> 攝取當歸、枸杞。'
    }
  },
  constitutions: {
    '氣虛質 (Qi Deficiency)': {
      intro: '您的身體目前就像一台引擎動力不足（心虛），且排水管道淤積了大量廢水（津液停聚）的機器。這不僅導致您感到的疲憊、水腫與睡眠不安，更是心血管系統發出的預警訊號。',
      red_light: `
        <h4>1. 斷絕「生濕」之源 (加重水腫與沈重感)</h4>
        <ul>
            <li>🈲 <span class="highlight-red">冰品與冷飲 (最關鍵)：</span> 低溫會直接癱瘓負責代謝水分的脾胃陽氣，導致水液立刻停滯。即日起請只喝溫熱水。</li>
            <li>🈲 <span class="highlight-red">生食與寒涼水果：</span> 生菜沙拉、生魚片，以及西瓜、火龍果、椰子水、奇異果等。</li>
            <li>🈲 <span class="highlight-red">甜膩與炸物：</span> 含糖飲料、甜點、炸物、糯米製品。「甘能生濕，油能阻氣」，這些是體內濕氣的最佳培養皿。</li>
        </ul>
        <h4>2. 停止「耗心」之源 (加重心悸與失眠)</h4>
        <ul>
            <li>🈲 <span class="highlight-red">熬夜：</span> 請務必於晚上 11:00 前入睡。熬夜極度耗損陰血，導致「心血不足」，心神不得安寧。</li>
            <li>🈲 <span class="highlight-red">過量刺激物：</span> 濃茶、黑咖啡、酒精。這如同對疲累的馬匹揮鞭，短暫提神後會導致更嚴重的「心氣虛」。</li>
        </ul>`,
      green_light: `
        <ul>
            <li>✅ <span class="highlight-green">養心安神 (補動力/穩神經)：</span> 紅棗(去核)、枸杞、桂圓肉(少量)、優質紅瘦肉(牛/羊，補鐵B12)、深綠色溫熱蔬菜(補鎂)、蓮子、百合。</li>
            <li>✅ <span class="highlight-green">健脾利濕 (排廢水/通管道)：</span> 薏仁(需乾炒過)、四神湯藥材(茯苓、山藥、芡實、蓮子)、冬瓜、玉米鬚、海帶/紫菜(高鉀利水)、陳皮(化濕理氣)。</li>
        </ul>`,
      dietary_rules: `
        <h4>1. 烹調溫度：全面溫熱化</h4>
        <ul>
            <li><strong>規則：</strong> 所有食物必須煮熟、溫熱食用。</li>
            <li><strong>理由：</strong> 您的脾胃陽氣虛弱，無法處理生冷食物。溫熱食物能減輕消化負擔，幫助身體「氣化」水分。首選蒸、煮、燉、煲湯。</li>
        </ul>
        <h4>2. 主食替換：功能性澱粉</h4>
        <ul>
            <li><strong>規則：</strong> 每日至少一餐，將精緻白米飯替換為具備藥性的澱粉。</li>
            <li><strong>執行：</strong> 例如餐單中的「山藥茯苓米飯」、「薏仁赤小豆粥」或「四神湯煮麵線」。直接在主食中加入健脾利水的功能。</li>
        </ul>
        <h4>3. 飲水紀律：少量溫飲，以茶代水</h4>
        <ul>
            <li><strong>規則：</strong> 禁止大口灌冷水。請「少量、多次、慢飲」溫熱水。</li>
            <li><strong>執行：</strong> 強烈建議飲用我們為您設計的「藥膳茶飲」（如黃耆玉米鬚飲）。對您的身體來說，帶有藥性的水比純水更容易被吸收利用與排出，不會積在體內變成濕氣。</li>
        </ul>
        <h4>4. 鹽分控制：低鈉排水</h4>
        <ul>
            <li><strong>規則：</strong> 嚴格控制鹽分與隱形高鈉醬料（醬油膏、豆瓣醬、醃漬品）。</li>
            <li><strong>理由：</strong> 鈉離子會緊緊鎖住水分，加重津液停聚與心臟負擔。請利用天然辛香料（蔥、薑、蒜、紫蘇）來增加風味。</li>
        </ul>`,
      lifestyle: `
        <h4>1. 睡眠修復工程：養肝血，安心神</h4>
        <ul>
            <li><strong>目標：</strong> 晚上 10:30 準備就寢，<strong>11:00 前務必入睡</strong>。</li>
            <li><strong>理由：</strong> 子時（23:00-01:00）與醜時（01:00-03:00）是肝膽經循行時間，此時熟睡才能養足氣血，提供心臟隔天的動力。</li>
        </ul>
        <h4>2. 運動策略：微汗護心法</h4>
        <ul>
            <li><strong>目標：</strong> 促進氣血循環與排汗，但不可耗傷心氣。</li>
            <li><strong>禁止：</strong> 高強度間歇運動 (HIIT)、長跑、大汗淋漓的劇烈運動（中醫云：汗為心之液，大汗傷心陽）。</li>
            <li><strong>建議：</strong> 快走、超慢跑、八段錦、太極拳。標準是<strong>「身體發熱，微微出汗，運動後感到精神舒暢而非疲憊不堪」</strong>。</li>
        </ul>
        <h4>3. 環境調整：避風寒，重保暖</h4>
        <ul>
            <li><strong>執行：</strong>
                <ul>
                    <li>確保居住環境乾燥，善用除濕機。</li>
                    <li>注意頸部（避免風邪吹入）與足部（寒從腳下起）的保暖。避免冷風直吹，特別是在睡眠時和運動出汗後。</li>
                </ul>
            </li>
        </ul>`,
      meal_plan: `
        <h3>第 1 週：啟動代謝，強力利濕</h3>
        <table class="menu-table">
            <thead>
                <tr>
                    <th style="width: 10%;">天數</th>
                    <th style="width: 30%;">早餐 (溫養啟動)</th>
                    <th style="width: 30%;">午餐 (健脾利濕主力)</th>
                    <th style="width: 30%;">晚餐 (安神輕負擔)</th>
                </tr>
            </thead>
            <tbody>
                <tr><td>Day 1</td><td>**山藥蓮子茯苓粥** (加紅棗) + 水煮蛋</td><td>**清蒸鱸魚** (蔥薑溫陽) + 溫拌菠菜 + 半碗五穀飯</td><td>**冬瓜蛤蜊薑絲湯** (強力利水) + 燙青菜</td></tr>
                <tr><td>Day 2</td><td>溫熱無糖豆漿加入**四神粉** 2匙 + 全麥饅頭</td><td>**四神湯底燉雞腿** (去皮) + 炒綜合菇類 + 半碗糙米飯</td><td>**番茄豆腐蔬菜湯** (高鉀排水) + 少量地瓜葉</td></tr>
                <tr><td>Day 3</td><td>**小米南瓜粥** + 少量核桃仁</td><td>**蒜蓉蒸蝦** + 溫炒莧菜 (補鎂) + 半碗紅藜麥飯</td><td>**海帶芽蛋花湯** + 煎櫛瓜片</td></tr>
                <tr><td>Day 4</td><td>燕麥粥加**桂圓、枸杞**</td><td>**炒薏仁排骨湯** (去濕主力) + 炒高麗菜 + 少量米飯</td><td>**清炒肉絲木耳** + 溫熱蔬菜湯</td></tr>
                <tr><td>Day 5</td><td>**山藥蓮子茯苓粥** + 水煮蛋</td><td>**香煎鮭魚排** + 溫拌花椰菜 + 半碗五穀飯</td><td>**百合固金湯底煮瘦肉片蔬菜** (寧心安神)</td></tr>
                <tr><td>Day 6</td><td>溫熱無糖豆漿加入**四神粉** + 全麥土司</td><td>**清燉牛肉片湯** (番茄底) + 半碗糙米飯</td><td>**冬瓜薏仁湯** (純利水) + 燙青菜 + 滷豆干</td></tr>
                <tr><td>Day 7</td><td>**小米紅棗粥** + 水煮蛋</td><td>**薑絲炒文蛤** + 溫炒空心菜 + **紫米飯**半碗</td><td>**山藥排骨湯** + 溫熱蔬菜</td></tr>
            </tbody>
        </table>
        <h3>第 2 週：加強養心，持續運化</h3>
        <table class="menu-table">
            <thead>
                <tr><th>天數</th><th>早餐 (溫養啟動)</th><th>午餐 (健脾利濕主力)</th><th>晚餐 (安神輕負擔)</th></tr>
            </thead>
            <tbody>
                <tr><td>Day 8</td><td>燕麥粥加**黑芝麻粉**、枸杞</td><td>**洋蔥炒牛肉片** + 溫燙地瓜葉 + 半碗五穀飯</td><td>**茯苓玉米濃湯** (茯苓粉勾芡) + 水煮雞胸肉</td></tr>
                <tr><td>Day 9</td><td>**山藥蓮子茯苓粥** + 水煮蛋</td><td>**清蒸鱈魚** + 炒綜合時蔬 + 半碗紅藜麥飯</td><td>**紫菜蛋花湯** + 溫拌菠菜</td></tr>
                <tr><td>Day 10</td><td>溫熱無糖豆漿加入**四神粉** + 蒸地瓜</td><td>**四神湯底煮低鹽麵線** (加瘦肉片青菜)</td><td>**番茄蔬菜牛肉清湯**</td></tr>
                <tr><td>Day 11</td><td>**小米南瓜粥** + 杏仁果</td><td>**乾煎鯖魚** + 溫炒高麗菜 + 半碗糙米飯</td><td>**冬瓜海帶湯** + 豆干炒肉絲</td></tr>
                <tr><td>Day 12</td><td>燕麥粥加**桂圓、紅棗** + 水煮蛋</td><td>**薑黃炒飯** (溫陽抗發炎，加雞丁)</td><td>**百合蓮子瘦肉湯** (專注安神) + 燙青菜</td></tr>
                <tr><td>Day 13</td><td>**山藥蓮子茯苓粥**</td><td>**清淡滷牛腱切片** + 溫拌綜合蔬菜 + 半碗紫米飯</td><td>**清炒絲瓜薑絲** + 豆腐味增湯</td></tr>
                <tr><td>Day 14</td><td>溫熱無糖豆漿 + 全麥饅頭夾蛋</td><td>**赤小豆薏仁湯** (無糖) 當主食 + 清炒雞柳</td><td>**溫拌綜合菇木耳** + 清淡蔬菜湯 + 烤魚</td></tr>
            </tbody>
        </table>`,
      seasonal: `
        <h2>第六部分：時令加值 — 三月份(驚蟄/春分)節氣養生指導</h2>
        <p><strong>當下挑戰：</strong> 三月陽氣生發，但乍暖還寒，且春雨濕氣重。這對「心虛濕重」的您是雙重考驗。</p>
        <h4>1. 飲食微調：「省酸增甘」養脾氣</h4>
        <ul>
            <li>春季肝氣旺，酸味入肝，吃太多酸會克制脾胃。應多吃「甘味（自然甜味）」食物顧脾胃，如山藥、大棗、小米。</li>
            <li>適量增加辛溫食材（韭菜、蔥、薑、香菜）幫助陽氣升發化濕。</li>
        </ul>
        <h4>2. 起居關鍵：「春捂」護心陽</h4>
        <ul>
            <li>不要急著收冬衣。重點保護 <strong>「頸部」</strong> 和 <strong>「腳踝」</strong>，避免溫差衝擊心臟血管。</li>
        </ul>
        <h4>3. 情緒調節：疏肝理氣</h4>
        <ul>
            <li>春季易煩躁，導致氣滯濕阻。請務必執行上述的「微汗運動」，保持心情舒暢。</li>
        </ul>`
    }
  }
};

function parseGeminiJson(raw: string): any {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with fallbacks.
  }

  const withoutFences = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  if (withoutFences) {
    try {
      return JSON.parse(withoutFences);
    } catch {
      // Continue with object slicing.
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error('Gemini response is not valid JSON.');
}

function getReadableErrorMessage(error: unknown): string {
  const extractApiMessage = (raw: string): string => {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.includes('"error"')) {
      try {
        const parsed = JSON.parse(trimmed);
        const nested = parsed?.error?.message;
        if (typeof nested === 'string' && nested.trim()) {
          return nested;
        }
      } catch {
        // Keep original message if parsing fails.
      }
    }
    return raw;
  };

  if (error && typeof error === 'object') {
    const err = error as any;
    const causeCode = err?.cause?.code;
    if (causeCode === 'UND_ERR_CONNECT_TIMEOUT') {
      return 'Unable to reach Gemini API (network timeout). Please check outbound network access and try again.';
    }
    if (causeCode === 'ENOTFOUND') {
      return 'Unable to resolve Gemini API host (DNS failure). Please check your network/DNS settings.';
    }
    if (causeCode === 'ECONNREFUSED') {
      return 'Connection to Gemini API was refused. Please check network proxy or firewall settings.';
    }
  }

  return error instanceof Error ? extractApiMessage(error.message) : 'AI generation failed.';
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // API: Get Clients
  app.get('/api/clients', (req, res) => {
    const clients = db.prepare("SELECT * FROM users WHERE role = 'client'").all();
    res.json(clients);
  });

  // API: Get Daily Logs for a Client
  app.get('/api/logs/:userId', (req, res) => {
    const logs = db.prepare('SELECT * FROM daily_logs WHERE user_id = ? ORDER BY date DESC').all(req.params.userId);
    res.json(logs);
  });

  // API: Get All Reports
  app.get('/api/reports', (req, res) => {
    const reports = db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all();
    res.json(reports);
  });

  // API: Save Report
  app.post('/api/reports/save', (req, res) => {
    const { client_name, client_phone, diagnosis, content } = req.body;
    db.prepare(`
      INSERT INTO reports (client_name, client_phone, diagnosis, content)
      VALUES (?, ?, ?, ?)
    `).run(client_name, client_phone, diagnosis, JSON.stringify(content));
    res.json({ success: true });
  });

  // API: Submit Daily Log
  app.post('/api/logs', (req, res) => {
    const { user_id, date, breakfast_img, lunch_img, dinner_img, sleep_start, sleep_end, water_cups, coffee, notes } = req.body;
    db.prepare(`
      INSERT INTO daily_logs (user_id, date, breakfast_img, lunch_img, dinner_img, sleep_start, sleep_end, water_cups, coffee, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user_id, date, breakfast_img, lunch_img, dinner_img, sleep_start, sleep_end, water_cups, coffee ? 1 : 0, notes);
    res.json({ success: true });
  });

  // API: Generate structured report JSON via Gemini
  app.post('/api/reports/ai-generate', async (req, res) => {
    try {
      const prompt = (req.body?.prompt || '').trim();
      const model = req.body?.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

      if (!prompt) {
        return res.status(400).json({ error: 'prompt is required.' });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: 'Missing GEMINI_API_KEY environment variable.' });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });

      res.json(parseGeminiJson(response.text || '{}'));
    } catch (error) {
      console.error('AI Generation Error:', error);
      res.status(500).json({ error: getReadableErrorMessage(error) });
    }
  });

  // API: Generate HTML Report for Printing
  app.post('/api/reports/generate', (req, res) => {
    const { client_name, client_phone, organs, constitutions } = req.body;

    const organData = organs.map((o: string) => KNOWLEDGE_BASE.organs[o]).filter(Boolean);
    const consData = constitutions.map((c: string) => KNOWLEDGE_BASE.constitutions[c]).filter(Boolean);

    const introText = consData[0]?.intro || '親愛的客戶，這份報告是我們為您量身打造的健康作戰藍圖。';

    const html = `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>中西醫整合營養尊榮調理行動指南</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Noto Sans TC', "Microsoft JhengHei", sans-serif; line-height: 1.7; color: #333; margin: 0; padding: 20px; background-color: #f4f4f4; }
        .container { max-width: 900px; margin: 0 auto; background-color: #fff; padding: 50px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; text-align: center; font-size: 32px; margin-bottom: 10px; padding-bottom: 20px; border-bottom: 4px solid #d35400; }
        .subtitle { text-align: center; color: #7f8c8d; font-size: 18px; margin-bottom: 40px; font-weight: 300; }
        h2 { color: #2980b9; font-size: 24px; border-left: 5px solid #2980b9; padding-left: 15px; margin-top: 40px; margin-bottom: 20px; background-color: #f9fbfc; padding-top: 10px; padding-bottom: 10px; }
        h3 { color: #d35400; font-size: 20px; margin-top: 30px; border-bottom: 2px dotted #e67e22; padding-bottom: 10px; }
        h4 { color: #16a085; font-size: 18px; margin-top: 25px; margin-bottom: 15px; }
        .info-box { background-color: #eef2f7; padding: 25px; border-radius: 10px; margin-bottom: 40px; border: 2px solid #dce4ec; }
        .info-box p { margin: 8px 0; }
        ul, ol { padding-left: 25px; }
        li { margin-bottom: 10px; }
        strong { color: #c0392b; font-weight: 700; }
        .highlight-green { color: #27ae60; font-weight: bold; }
        .highlight-red { color: #c0392b; font-weight: bold; }
        .strategy-table, .menu-table { width: 100%; border-collapse: collapse; margin: 25px 0; font-size: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
        .strategy-table th, .strategy-table td, .menu-table th, .menu-table td { border: 1px solid #e0e0e0; padding: 15px; text-align: left; vertical-align: top; }
        .strategy-table th, .menu-table th { background-color: #34495e; color: white; font-weight: 700; }
        .menu-table tr:nth-child(even) { background-color: #f8f9fa; }
        .menu-table tr td:first-child { font-weight: bold; color: #d35400; }
        @media print {
            body { background-color: #fff; margin: 0; padding: 20px; font-size: 12pt; }
            .container { width: 100% !important; max-width: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important; }
            * { font-family: 'Noto Sans TC', sans-serif !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            h2, h3, h4, p, li, div { page-break-inside: auto; }
            h2, h3, h4 { page-break-after: avoid; }
            tr { page-break-inside: avoid; }
            table { page-break-inside: auto; }
            * { overflow: visible !important; }
        }
    </style>
</head>
<body>
<div class="container">
    <h1>【最高機密】中西醫整合營養尊榮調理行動指南</h1>
    <div class="subtitle">Integrative Nutrition Premium Action Guide: Heart & Harmony Project</div>
    <div class="info-box">
        <p><strong>客戶姓名：</strong> ${client_name} 尊鑒</p>
        <p><strong>客戶電話：</strong> ${client_phone}</p>
        <p><strong>執行期間：</strong> 202X 年 3 月 (為期兩週啟動期)</p>
        <p><strong>核心診斷：</strong> ${organs.join(' + ')} ＋ ${constitutions.join(' + ')}</p>
        <p><strong>總體目標：</strong> 透過溫和手段重啟身體代謝排水功能，同時滋養心臟動力，預防潛在心血管風險。</p>
    </div>
    <h2>導言：為您的身體進行一場精準的溫柔革命</h2>
    <p>${introText}</p>
    <p>為了徹底扭轉這個局面，我們制定了以下的雙軌整合策略，請務必詳閱並落實於每日生活中。</p>

    <h2>第一部分：中西醫整合策略總覽 (The Integrative Strategy)</h2>
    <p>我們為什麼要這樣吃？以下是本方案背後的科學與哲學邏輯：</p>
    <table class="strategy-table">
        <thead>
            <tr><th style="width: 15%;">視角</th><th style="width: 40%;">您的狀況分析</th><th style="width: 45%;">我們的核心調理策略</th></tr>
        </thead>
        <tbody>
            ${organData.map(data => `
            <tr>
                <td><strong>西醫精準營養</strong></td>
                <td><strong>問題：</strong> ${data.western_analysis}</td>
                <td><strong>對策：</strong><br>${data.western_strategy}</td>
            </tr>
            <tr>
                <td><strong>中醫辨證施治</strong></td>
                <td><strong>問題：</strong> ${data.tcm_analysis}</td>
                <td><strong>對策：</strong><br>${data.tcm_strategy}</td>
            </tr>
            `).join('')}
        </tbody>
    </table>

    <h2>第二部分：行動基礎 — 紅燈與綠燈法則 (Ground Rules)</h2>
    <p>任何調理若不停止錯誤的習慣，都將徒勞無功。請嚴格遵守。</p>
    ${consData.map(data => `
        <h3 class="highlight-red">【紅燈區：嚴格禁止】(Stop List)</h3>
        <p>這兩大類習慣正在持續消耗您的心氣，並加重體內濕氣堆積。</p>
        ${data.red_light}
        <h3 class="highlight-green">【綠燈區：核心食材採購指南】(Go List)</h3>
        ${data.green_light}
    `).join('')}

    <h2>第三部分：關鍵飲食執行規則 (Key Dietary Rules)</h2>
    <p>知道「吃什麼」還不夠，重點是「怎麼吃」。針對您的體質，請落實以下規則：</p>
    ${consData.map(data => data.dietary_rules).join('')}

    <h2>第四部分：生活型態解決方案 (Lifestyle Solutions)</h2>
    <p>飲食之外，生活習慣是支持調理的關鍵支柱。</p>
    ${consData.map(data => data.lifestyle).join('')}

    <h2>第五部分：實作演練 — 2週中西醫整合調理示範餐單</h2>
    <div class="info-box" style="background-color: #fff8e1; border-color: #ffe082;">
        <h3 style="margin-top: 0; border-bottom: none; color: #f57c00;">🌟 週末關鍵準備 (Weekend Prep)</h3>
        <ol>
            <li><strong>四神強脾利濕底：</strong> 茯苓、山藥、芡實、蓮子（比例 1:1:1:1）磨粉或燉煮濃縮湯底。</li>
            <li><strong>養氣排水茶飲包：</strong> 黃耆(補氣)、玉米鬚(利水)、陳皮(理氣)、炒薏仁(祛濕)分裝 14 小包，每日沖泡。</li>
        </ol>
    </div>
    ${consData.map(data => data.meal_plan).join('')}

    ${consData.map(data => data.seasonal).join('')}

    <div style="text-align: center; margin-top: 60px; padding-top: 20px; border-top: 3px solid #d35400;">
        <h3 style="border: none; color: #2c3e50; margin-top: 0;">結語</h3>
        <p style="font-size: 1.1em; color: #555;">這份指南非常詳盡，因為您的健康值得最細緻的對待。請按部就班執行，我們將在兩週後檢視您的身體變化。祝您執行順利，重拾身心平衡。</p>
    </div>
</div>
<script>
    window.onload = function() {
        setTimeout(function() { window.print(); }, 1500);
    }
</script>
</body>
</html>
    `;
    res.send(html);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist/index.html')));
  }

  app.listen(3000, '0.0.0.0', () => {
    console.log('Server running on http://localhost:3000');
  });
}

startServer();
