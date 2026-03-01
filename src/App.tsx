import React, { useState } from 'react';
import {
  ClipboardList, 
  Camera, 
  CheckCircle, 
  Download,
  Activity,
  Plus,
  Sparkles,
  Mail
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generateReportFromPrompt } from './lib/geminiClient';

// --- Constants ---
const ORGANS = [
  '膀胱虛弱', '膽虛', '小腸虛弱', '大腸虛弱', '胃虛', '腎虛', 
  '肺虛', '脾虛', '肝虛', '心虛', '津液停聚', '津液虧虛'
];

const CONSTITUTIONS = [
  '平和型', '氣虛型', '陽虛型', '陰虛型', '痰濕型', '濕熱型', '血瘀型', '氣鬱型', '特稟型', '血虛型'
];

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <AgentPortal />
    </div>
  );
}

// --- CS Agent Portal ---
function AgentPortal() {
  const [primaryOrgan, setPrimaryOrgan] = useState<{ name: string, score: number } | null>(null);
  const [otherOrgans, setOtherOrgans] = useState<{ name: string, score: number }[]>([]);
  const [selectedConstitutions, setSelectedConstitutions] = useState<{ name: string, score: number }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [aiReport, setAiReport] = useState<any | null>(null);
  const [uploadedLogo, setUploadedLogo] = useState<string | null>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedLogo(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const getScoreStatus = (score: number) => {
    if (score < 60) return '(嚴重) ：強化修復 + 密集調理';
    if (score <= 80) return '(需調理) ：溫和調理 + 鞏固';
    return '(良好) ：預防保健';
  };

  const mealLabels = ['早餐', '午餐', '晚餐'] as const;

  const parseDayNumber = (key: string): number | null => {
    const match = key.match(/day\s*(\d{1,2})/i);
    if (!match) return null;
    const day = Number(match[1]);
    if (!Number.isFinite(day) || day <= 0 || day > 31) return null;
    return day;
  };

  const normalizeText = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  };

  const extractMealsFromText = (text: string) => {
    const source = normalizeText(text);
    const extracted: Record<string, string> = {};

    for (const label of mealLabels) {
      const pattern = new RegExp(
        `${label}\\s*[:：]\\s*([\\s\\S]*?)(?=(?:早餐|午餐|晚餐)\\s*[:：]|$)`,
        'i'
      );
      const match = source.match(pattern);
      if (match?.[1]) {
        const content = match[1].replace(/^[,，;；\s]+|[,，;；\s]+$/g, '').trim();
        if (content) {
          extracted[label] = content;
        }
      }
    }

    return extracted;
  };

  const normalizeMealValue = (value: any): any => {
    if (value && typeof value === 'object') {
      const content = normalizeText(value.內容);
      const calories = normalizeText(value.熱量);
      if (content || calories) {
        return {
          內容: content || '—',
          熱量: calories || '',
        };
      }
    }

    return normalizeText(value);
  };

  const isMealEmpty = (value: any): boolean => {
    if (!value) return true;
    if (typeof value === 'string') {
      return value.trim() === '' || value.trim() === '—';
    }
    if (typeof value === 'object') {
      const content = normalizeText(value.內容);
      const calories = normalizeText(value.熱量);
      return !content && !calories;
    }
    return false;
  };

  const normalizeDayMeals = (raw: any): Record<string, any> => {
    const normalized: Record<string, any> = {
      早餐: '',
      午餐: '',
      晚餐: '',
    };

    const applyExtracted = (source: string) => {
      const extracted = extractMealsFromText(source);
      for (const label of mealLabels) {
        if (extracted[label] && isMealEmpty(normalized[label])) {
          normalized[label] = extracted[label];
        }
      }
    };

    if (typeof raw === 'string') {
      applyExtracted(raw);
      if (mealLabels.every((label) => isMealEmpty(normalized[label]))) {
        normalized.早餐 = normalizeText(raw);
      }
    } else if (raw && typeof raw === 'object') {
      for (const label of mealLabels) {
        if (raw[label] !== undefined) {
          normalized[label] = normalizeMealValue(raw[label]);
        }
      }

      for (const [key, value] of Object.entries(raw)) {
        if ((mealLabels as readonly string[]).includes(key)) {
          continue;
        }
        const valueText = typeof value === 'string' ? value : '';
        applyExtracted(`${key} ${valueText}`.trim());
        if (valueText) {
          applyExtracted(valueText);
        }
      }
    }

    for (const label of mealLabels) {
      if (isMealEmpty(normalized[label])) {
        normalized[label] = '—';
      }
    }

    return normalized;
  };

  const mergeDayMeals = (base: Record<string, any>, incoming: Record<string, any>) => {
    const merged: Record<string, any> = { ...base };
    for (const label of mealLabels) {
      if (isMealEmpty(merged[label]) && !isMealEmpty(incoming[label])) {
        merged[label] = incoming[label];
      }
    }
    return merged;
  };

  const normalizeTwoWeekMenu = (raw: any): Record<string, Record<string, any>> => {
    const days = new Map<number, Record<string, any>>();

    const upsertDay = (dayNumber: number, value: any) => {
      const normalized = normalizeDayMeals(value);
      const existing = days.get(dayNumber);
      days.set(dayNumber, existing ? mergeDayMeals(existing, normalized) : normalized);
    };

    const processEntry = (key: string, value: any) => {
      const dayNum = parseDayNumber(key);
      if (dayNum !== null) {
        upsertDay(dayNum, value);
      }
    };

    if (raw && typeof raw === 'object') {
      for (const [topKey, topValue] of Object.entries(raw)) {
        const topDay = parseDayNumber(topKey);
        if (topDay !== null) {
          upsertDay(topDay, topValue);
          continue;
        }

        if (!topValue || typeof topValue !== 'object') {
          continue;
        }

        const nestedEntries = Object.entries(topValue);
        const nestedDayNumbers: number[] = [];
        const strayFragments: string[] = [];

        for (const [nestedKey, nestedValue] of nestedEntries) {
          const nestedDay = parseDayNumber(nestedKey);
          if (nestedDay !== null) {
            nestedDayNumbers.push(nestedDay);
            upsertDay(nestedDay, nestedValue);
          } else {
            const fragment = `${nestedKey} ${typeof nestedValue === 'string' ? nestedValue : ''}`.trim();
            if (fragment) {
              strayFragments.push(fragment);
            }
          }
        }

        if (nestedDayNumbers.length > 0 && strayFragments.length > 0) {
          const targetDay = Math.min(...nestedDayNumbers);
          const merged = mergeDayMeals(days.get(targetDay) || normalizeDayMeals({}), normalizeDayMeals(strayFragments.join(' ')));
          days.set(targetDay, merged);
        } else if (nestedDayNumbers.length === 0) {
          processEntry(topKey, topValue);
        }
      }
    }

    const sortedDayNumbers = Array.from(days.keys()).sort((a, b) => a - b);
    const week1: Record<string, any> = {};
    const week2: Record<string, any> = {};

    for (const day of sortedDayNumbers) {
      const label = `Day ${day}`;
      if (day <= 7) {
        week1[label] = days.get(day);
      } else {
        week2[label] = days.get(day);
      }
    }

    const normalizedMenu: Record<string, Record<string, any>> = {};
    if (Object.keys(week1).length > 0) {
      normalizedMenu['Week 1 (啟動期)'] = week1;
    }
    if (Object.keys(week2).length > 0) {
      normalizedMenu['Week 2 (鞏固期)'] = week2;
    }

    if (!Object.keys(normalizedMenu).length) {
      normalizedMenu['Week 1 (啟動期)'] = { 'Day 1': normalizeDayMeals(raw) };
    }

    return normalizedMenu;
  };

  const normalizeArray = (value: any): any[] => (Array.isArray(value) ? value : []);

  const normalizeReportPayload = (payload: any) => ({
    ...payload,
    goal: normalizeText(payload?.goal),
    intro_title: normalizeText(payload?.intro_title),
    intro_paragraphs: normalizeArray(payload?.intro_paragraphs).map((item) => normalizeText(item)).filter(Boolean),
    integrative_strategy: {
      western_analysis: normalizeText(payload?.integrative_strategy?.western_analysis),
      western_strategy: normalizeText(payload?.integrative_strategy?.western_strategy),
      tcm_analysis: normalizeText(payload?.integrative_strategy?.tcm_analysis),
      tcm_strategy: normalizeText(payload?.integrative_strategy?.tcm_strategy),
    },
    red_light_items: normalizeArray(payload?.red_light_items).map((item) => ({
      title: normalizeText(item?.title),
      content: normalizeText(item?.content),
    })),
    green_light_list: normalizeArray(payload?.green_light_list).map((item) => normalizeText(item)).filter(Boolean),
    diet_rules: normalizeArray(payload?.diet_rules).map((item) => ({
      title: normalizeText(item?.title),
      content: normalizeText(item?.content),
    })),
    lifestyle_solutions: normalizeArray(payload?.lifestyle_solutions).map((item) => ({
      title: normalizeText(item?.title),
      content: normalizeText(item?.content),
    })),
    seasonal_guidance: {
      february: normalizeText(payload?.seasonal_guidance?.february),
      march: normalizeText(payload?.seasonal_guidance?.march),
    },
    two_week_menu: normalizeTwoWeekMenu(payload?.two_week_menu),
    product_intro: normalizeText(payload?.product_intro),
    product_recommendations: normalizeArray(payload?.product_recommendations).map((item) => ({
      line: normalizeText(item?.line),
      name: normalizeText(item?.name),
      reason: normalizeText(item?.reason),
      principle: normalizeText(item?.principle),
    })),
    conclusion: normalizeText(payload?.conclusion),
  });

  const handleGenerateAIReport = async () => {
    if (!primaryOrgan) {
      alert('請選擇一項【首要臟腑問題】！');
      return;
    }

    setIsGenerating(true);
    setAiReport(null);

    try {
      // Calculate strategy based on minimum score
      const allScores = [
        primaryOrgan.score,
        ...otherOrgans.map(o => o.score),
        ...selectedConstitutions.map(c => c.score)
      ];
      const minScore = Math.min(...allScores);
      
      let strategyText = "";
      let strategyColor = "";
      if (minScore < 60) {
        strategyText = "嚴重 (強化修復 + 密集調理)";
        strategyColor = "#c0392b";
      } else if (minScore <= 80) {
        strategyText = "需調理 (溫和調理 + 鞏固)";
        strategyColor = "#e67e22";
      } else {
        strategyText = "良好 (基礎保養 + 維持)";
        strategyColor = "#27ae60";
      }

      const diagnosisSummary = `首要：${primaryOrgan.name}(${primaryOrgan.score}分) | 次要：${otherOrgans.map(d => `${d.name}(${d.score}分)`).join(', ') || '無'} | 參考體質：${selectedConstitutions.map(c => c.name).join(', ') || '無'}`;
      const now = new Date();
      const currentDateText = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

      const prompt = `
        你現在是一位擁有 30 年經驗的資深中西醫整合醫學專家。請根據以下數據，為客戶撰寫一份深度調理報告。

        【客戶診斷數據】
        - **核心病機 (首要問題)**：${primaryOrgan.name} (分數: ${primaryOrgan.score}/100)
        - **相關兼證 (次要問題)**：${otherOrgans.map(o => `${o.name} (${o.score}分)`).join(', ') || '無'}
        - **體質背景 (身體土壤)**：${selectedConstitutions.map(c => `${c.name} (${c.score}分)`).join(', ') || '無'}
        - **系統判定策略等級**：${strategyText}
        - **當前日期**：${currentDateText}

        ---

        【你的執行步驟】
        1. **定調核心**：分析首要問題在中醫與西醫營養學上的意義。
        2. **審視關聯**：分析次要問題與體質是如何「推波助瀾」或加重首要問題的。
        3. **制定整合策略**：標本兼治，語氣需與策略等級相符。
        4. **產品匹配**：從下方的「白燕 (Nesture) 產品數據庫」中，為 5 大產品線（食療、藥膳湯、焗湯、茶療、足療）各挑選 1 款最精準的產品。**必須嚴格使用數據庫中的完整產品名稱。**
        5. **產品引言**：為產品推介部分撰寫一段溫馨的引言，特別針對那些平時工作繁忙、沒有時間自行準備食材的客戶，說明這些產品如何提供便捷的解決方案。

        ---

        【白燕 (Nesture) 產品數據庫 (必須嚴格跟從名稱)】：
        - **食療系列**：FA01 烏黑養腎精華生髮飲, FA02 必白美肌精華素顏飲, FA03 漲杯美肌精華豐胸飲, FA04 抗氧抗衰精華逆齡飲, FA05 階段1「疏」姨媽前｜紅粉菲菲養血暖宮飲, FA06 階段2「排」姨媽中｜紅粉菲菲養血暖宮飲, FA07 階段3「養」日常補｜紅粉菲菲養血暖宮飲, FC01 寶寶積食健脾飲, FC02 腎氣寶寶聰明飲, FC03 寶寶補氣養血飲, FC04 視力寶寶護眼飲, FC05 護肺靈止咳潤肺飲, FM01 健脾美白營養飲, FM02 排清胎毒營養飲, FM03 祛腫控糖營養飲, FM04 孕期安睡營養飲, FM05 通便營養飲, FM06 腎氣富媽飲。
        - **藥膳湯療**：S01 人蔘花陳皮瑤柱燉排骨雞腳湯, S02 沙參玉竹瑤柱燉排骨雞腳湯, S03 黑豆黃精黨參燉瑤柱雞腳湯, S04 當歸熟地南棗燉排骨雞腳湯, S05 白茅根茯苓燉月季花湯, S06 茯苓酸棗仁燉陳皮甘草湯, S07 五指毛桃炒白術茯苓燉排骨雞腳湯, S08 鹿茸片葛根黃耆瑤柱燉雞腳湯, SA01 酸棗仁茯苓燉陳皮排骨湯, SA02 素馨花陳皮燉赤小豆薏仁湯, SA03 五指毛桃炒薏仁白术燉瑤柱排骨湯, SA04 當歸五指毛桃燉排骨雞腳湯, SA05 五指毛桃益母草燉當歸湯, SA06 五指元氣烏髮湯, SA07 丹參白术燉瑤柱薏苡仁湯, SA08 五指毛桃瑤柱燉陳皮蓮子百合湯, SB01 梔子薏仁燉陳皮排骨湯, SB02 土茯苓赤小豆扁豆燉月季花湯, SB03 布渣葉扁豆花炒白術燉排骨雞腳湯, SB04 土茯苓赤芍燉排骨雞腳湯, SB05 蒲公英蛇舌草王不留行燉雞腳湯, SB06 女貞首烏固髮湯, SB07 赤小豆白芷荷葉燉瑤柱葛根湯, SC01 玉竹沙參茯苓燉排骨雞腳湯, SC02 芍茯苓燉陳皮麥冬湯, SC03 沙參玉竹燉玉米鬚白扁豆湯, SC04 熟地玉竹黃精燉排骨雞腳湯, SC05 王不留行沙參燉枸杞當歸湯, SC06 女貞黑鑽固本湯, SC07 沙參桑白皮燉瑤柱百合湯, SC08 沙參玉竹燉瑤柱百合湯, SE01 黨參葛根燉陳皮貝母湯, SE02 陳皮佛手燉玉米鬚茯苓湯, SE03 炒薏仁月季花燉陳皮排骨雞腳湯, SE04 赤小豆扁豆薏仁燉瑤柱排骨湯, SE05 薏仁玉米鬚燉月季花排骨雞腳湯, SE06 五指毛桃茯苓赤小豆燉排骨雞腳湯, SE07 杜仲巴戟驅濕固髮湯, SE08 炒薏仁白扁豆陳皮燉瑤柱排骨湯, SF01 太子蔘茯苓燉陳皮排骨湯, SF02 玉米鬚燉浮小麥湯, SF03 土茯苓布渣葉陳皮炭燉排骨雞腳湯, SF04 當歸白芍燉排骨雞腳湯, SF05 五指毛桃葛根燉黨參當歸湯, SF06 制何首烏黑豆桑寄生固髮湯, SF07 黃芪玉竹燉瑤柱百合湯, SF08 椰子南北杏雪梨瑤柱燉排骨湯, SG01 丹參益母草燉當歸茯苓湯, SG02 雞血藤生艾葉蜜棗燉排骨雞腳湯, SG03 益母草山楂燉陳皮茯苓湯, SG04 當歸尾赤芍蘇木燉排骨雞腳湯, SG05 王不留行黃耆燉肉桂當歸湯, SG06 丹參牛膝固髮湯, SG07 川芎當歸尾燉瑤柱排骨湯, SG08 石斛草黨參陳皮燉瑤柱排骨湯。
        - **焗湯系列**：B01 抗敏無咳寶寶 (成人：强肺防敏飲), B02 中氣十足寶寶 (成人：補腦強腰飲), B03 視力精靈寶寶 (成人：抗藍光護眼飲), B04 胃口大開寶寶 (成人：消滯開胃飲), B05 聰明發育寶寶 (成人：烏髮抗衰飲), B06 索美人 | 排毒消脂, B07 喉嚨救兵 | 護肺止咳, B08 鐵打佬 | 健肌壯筋骨, B09 唔再濕滯｜健脾祛濕, B10 夜鬼熬夜救星｜清肝降火, B11 宫好唔易老 | 美肌養顏。
        - **茶療系列**：T01 腎氣補補生髮茶, T02 深睡助眠茶, T03 排毒降火祛痘茶, T04 補胸漲杯茶, T05 養胃修復茶, T06 熬夜排毒清肝茶, T07 養雌逆齡茶, T08 刮油祛濕茶, T09 氣血補補素顏茶, T10 「早C晚A」美白抗氧抗衰茶。
        - **足療系列**：f01 【解鬱安眠神泡】- 壓力山大｜失眠救星足浴包, f02 【好孕暖宮寶】- 宮寒備孕｜助孕神器足浴包, f03 【清熱袪痘戰士】- 面油口氣｜脾胃救星足浴包, f04 【月月輕鬆暖宮寶】- 手腳冰涼｜經痛剋星足浴包, f05 【爆汗祛濕寶】- 專攻水腫肚脹｜踢走濕重感足浴包。

        ---

        【必須加入的專業飲食規則】：
        - 飯前蘋果醋水；比例 0.5-1 碗澱粉 + 1 手掌肉 + 1 碗菜；禁小麥製品與紅肉；進食次序 肉->飯->菜；5點前低糖水果；餐後適量溫水；每週2天斷食日。

        ---

        【最終輸出要求】
        請僅回傳一個純粹的 JSON 物件，嚴禁包含任何 Markdown 標記。
        **注意：兩週餐單必須完整包含 Day 1 到 Day 14 的每一天，不可省略。**
        JSON 結構如下：
        {
            "goal": "...",
            "intro_title": "...",
            "intro_paragraphs": ["...", "..."],
            "integrative_strategy": {
                "western_analysis": "...", "western_strategy": "...",
                "tcm_analysis": "...", "tcm_strategy": "..."
            },
            "red_light_items": [{"title": "...", "content": "..."}],
            "green_light_list": ["..."],
            "diet_rules": [{"title": "...", "content": "..."}],
            "lifestyle_solutions": [{"title": "...", "content": "..."}],
            "seasonal_guidance": {"february": "...", "march": "..."},
            "two_week_menu": {
                "Week 1 (啟動期)": {
                    "Day 1": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    },
                    "Day 2": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    },
                    "Day 3": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    },
                    "Day 4": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    },
                    "Day 5": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    },
                    "Day 6": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    },
                    "Day 7": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    }
                },
                "Week 2 (鞏固期)": {
                    "Day 8": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    },
                    "Day 9": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    },
                    "Day 10": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    },
                    "Day 11": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    },
                    "Day 12": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    },
                    "Day 13": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    },
                    "Day 14": {
                        "早餐": {"內容": "...", "熱量": "約 300 kcal"},
                        "午餐": {"內容": "...", "熱量": "約 500 kcal"},
                        "晚餐": {"內容": "...", "熱量": "約 400 kcal"}
                    }
                }
            },
            "product_intro": "針對繁忙客戶的溫馨引言...",
            "product_recommendations": [
                {"line": "食療系列", "name": "產品名稱", "reason": "匹配理由", "principle": "推介原理"},
                {"line": "藥膳湯療", "name": "...", "reason": "...", "principle": "..."},
                {"line": "焗湯系列", "name": "...", "reason": "...", "principle": "..."},
                {"line": "茶療系列", "name": "...", "reason": "...", "principle": "..."},
                {"line": "足療系列", "name": "...", "reason": "...", "principle": "..."}
            ],
            "conclusion": "..."
        }
      `;

      const data = await generateReportFromPrompt(prompt);
      setAiReport({
        ...normalizeReportPayload(data),
        strategyText,
        strategyColor,
        diagnosisSummary
      });
    } catch (error) {
      console.error('AI Generation Error:', error);
      const message = error instanceof Error ? error.message : '未知錯誤';
      alert(`AI 生成報告失敗：${message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!aiReport) return;

    const reportElement = document.querySelector('.report-container');
    if (!reportElement) {
      alert('找不到可下載的報告內容。');
      return;
    }

    setIsDownloadingPdf(true);
    let exportHost: HTMLDivElement | null = null;
    try {
      const [{ toCanvas }, { jsPDF }] = await Promise.all([
        import('html-to-image'),
        import('jspdf'),
      ]);

      exportHost = document.createElement('div');
      exportHost.className = 'pdf-export-host';

      const clonedReport = (reportElement as HTMLElement).cloneNode(true) as HTMLElement;
      clonedReport.classList.add('pdf-export-clone');
      exportHost.appendChild(clonedReport);
      document.body.appendChild(exportHost);

      if ('fonts' in document) {
        await (document as Document & { fonts: FontFaceSet }).fonts.ready;
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      const canvas = await toCanvas(clonedReport, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: '#ffffff',
      });

      const sourceCtx = canvas.getContext('2d');
      if (!sourceCtx) {
        throw new Error('PDF 畫布上下文初始化失敗。');
      }

      const imageData = sourceCtx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      const findContentBounds = () => {
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = -1;
        let maxY = -1;
        const step = 2;

        for (let y = 0; y < canvas.height; y += step) {
          for (let x = 0; x < canvas.width; x += step) {
            const idx = (y * canvas.width + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            const a = pixels[idx + 3];
            const isBlank = a < 16 || (r > 248 && g > 248 && b > 248);
            if (isBlank) continue;

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }

        if (maxX < 0 || maxY < 0) {
          return null;
        }

        const pad = 4;
        return {
          minX: Math.max(0, minX - pad),
          maxX: Math.min(canvas.width - 1, maxX + pad),
          minY: Math.max(0, minY - pad),
          maxY: Math.min(canvas.height - 1, maxY + pad),
        };
      };

      const bounds = findContentBounds();
      if (!bounds) {
        throw new Error('未檢測到可導出的報告內容。');
      }

      const rowInkScore = (rowY: number, minX: number, maxX: number) => {
        const stepX = 3;
        let score = 0;
        for (let x = minX; x <= maxX; x += stepX) {
          const idx = (rowY * canvas.width + x) * 4;
          const r = pixels[idx];
          const g = pixels[idx + 1];
          const b = pixels[idx + 2];
          const a = pixels[idx + 3];
          const isInk = a > 16 && (r < 248 || g < 248 || b < 248);
          if (isInk) score += 1;
        }
        return score;
      };

      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
        compress: true,
      });

      const pageWidthMm = 210;
      const pageHeightMm = 297;
      const marginMm = 8;
      const contentWidthMm = pageWidthMm - marginMm * 2;
      const contentHeightMm = pageHeightMm - marginMm * 2;

      const horizontalPadPx = Math.max(8, Math.floor((bounds.maxX - bounds.minX + 1) * 0.03));
      const srcX = Math.max(0, bounds.minX - horizontalPadPx);
      const srcMaxX = Math.min(canvas.width - 1, bounds.maxX + horizontalPadPx);
      const srcWidthPx = srcMaxX - srcX + 1;

      const pxPerMm = srcWidthPx / contentWidthMm;
      const pageSliceHeightPx = Math.floor(contentHeightMm * pxPerMm);
      const searchRangePx = Math.floor(pageSliceHeightPx * 0.15);
      const minSliceHeightPx = Math.floor(pageSliceHeightPx * 0.72);
      const maxSliceHeightPx = Math.floor(pageSliceHeightPx * 1.2);
      const renderX = (pageWidthMm - contentWidthMm) / 2;

      let offsetY = bounds.minY;
      const exportEndY = bounds.maxY + 1;
      let pageIndex = 0;

      while (offsetY < exportEndY) {
        let sliceHeightPx = Math.min(pageSliceHeightPx, exportEndY - offsetY);

        if (offsetY + sliceHeightPx < exportEndY) {
          const idealEnd = offsetY + pageSliceHeightPx;
          const lowerSearchY = Math.max(
            offsetY + minSliceHeightPx,
            idealEnd - searchRangePx
          );
          const upperSearchY = Math.min(
            exportEndY - 1,
            offsetY + maxSliceHeightPx,
            idealEnd + searchRangePx
          );

          let bestY = idealEnd;
          let bestScore = Number.POSITIVE_INFINITY;
          let bestWhitespaceDistance = Number.POSITIVE_INFINITY;
          const sampledColumns = Math.max(1, Math.floor(srcWidthPx / 3));
          const whitespaceThreshold = Math.max(2, Math.floor(sampledColumns * 0.01));

          for (let y = lowerSearchY; y <= upperSearchY; y += 1) {
            const score = rowInkScore(y, srcX, srcMaxX);
            const distance = Math.abs(y - idealEnd);

            if (score <= whitespaceThreshold) {
              if (distance < bestWhitespaceDistance) {
                bestWhitespaceDistance = distance;
                bestY = y;
                bestScore = score;
              }
              continue;
            }

            if (bestWhitespaceDistance === Number.POSITIVE_INFINITY && score < bestScore) {
              bestScore = score;
              bestY = y;
            }
          }

          const adjustedSliceHeight = bestY - offsetY;
          if (adjustedSliceHeight > 1) {
            sliceHeightPx = adjustedSliceHeight;
          }
        }

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = srcWidthPx;
        pageCanvas.height = sliceHeightPx;

        const ctx = pageCanvas.getContext('2d');
        if (!ctx) {
          throw new Error('PDF canvas context 初始化失敗。');
        }

        ctx.drawImage(
          canvas,
          srcX,
          offsetY,
          srcWidthPx,
          sliceHeightPx,
          0,
          0,
          srcWidthPx,
          sliceHeightPx
        );

        if (pageIndex > 0) {
          pdf.addPage();
        }

        const sliceImageData = pageCanvas.toDataURL('image/jpeg', 0.98);
        const renderHeightMm = sliceHeightPx / pxPerMm;
        pdf.addImage(
          sliceImageData,
          'JPEG',
          renderX,
          marginMm,
          contentWidthMm,
          renderHeightMm,
          undefined,
          'FAST'
        );

        offsetY += sliceHeightPx;
        pageIndex += 1;
      }

      const now = new Date();
      const pad = (num: number) => String(num).padStart(2, '0');
      const filename =
        `tcm-report-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.pdf`;

      pdf.save(filename);
    } catch (error) {
      console.error('Download PDF Error:', error);
      const message = error instanceof Error ? error.message : '未知錯誤';
      alert(`下載 PDF 失敗：${message}`);
    } finally {
      exportHost?.remove();
      setIsDownloadingPdf(false);
    }
  };

  const handleEmail = () => {
    if (!aiReport) return;
    
    const subject = encodeURIComponent("<Premium定制> 中西醫整合營養調理指南");
    const body = encodeURIComponent(`
調理指南摘要：
整體策略等級：${aiReport.strategyText}
核心診斷摘要：${aiReport.diagnosisSummary}
總體目標：${aiReport.goal}

請查看完整報告內容。
    `);
    
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="p-6 lg:p-12 max-w-7xl mx-auto"
    >
      <header className="mb-10">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
          <Activity className="text-indigo-600" /> 智養師報告 Dashboard
        </h1>
        <p className="text-slate-500 mt-2">Manage client diagnoses and generate professional TCM reports.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Diagnosis Panel */}
        <div className="lg:col-span-2 space-y-8">
          <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <ClipboardList className="text-indigo-500" /> Report Generator
              </h2>
            </div>

            <div className="space-y-6">
              <div className="bg-slate-50 p-6 rounded-2xl border border-dashed border-slate-300">
                <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                  <Camera size={16} className="text-indigo-500" /> 手動上傳 Logo (Manual Logo Upload)
                </label>
                <div className="flex items-center gap-4">
                  <input 
                    type="file" 
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                    id="logo-upload"
                  />
                  <label 
                    htmlFor="logo-upload"
                    className="cursor-pointer bg-white border border-slate-200 px-4 py-2 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2"
                  >
                    <Plus size={16} /> 選擇圖片
                  </label>
                  {uploadedLogo && (
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200">
                      <img src={uploadedLogo} alt="Preview" className="w-full h-full object-contain" />
                      <button 
                        onClick={() => setUploadedLogo(null)}
                        className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl-lg"
                      >
                        <Plus size={12} className="rotate-45" />
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-2">建議使用透明背景 PNG 或正方形圖片。</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">首要臟腑問題 (只可揀一項)</label>
                <div className="flex flex-wrap gap-2 mb-4">
                  {ORGANS.map(organ => (
                    <button
                      key={organ}
                      onClick={() => setPrimaryOrgan(primaryOrgan?.name === organ ? null : { name: organ, score: 60 })}
                      className={`px-4 py-2 rounded-xl text-sm transition-all border ${
                        primaryOrgan?.name === organ 
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' 
                        : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'
                      }`}
                    >
                      {organ}
                    </button>
                  ))}
                </div>
                {primaryOrgan && (
                  <div className="bg-indigo-50 p-4 rounded-2xl flex items-center gap-4">
                    <span className="text-sm font-bold text-indigo-700">{primaryOrgan.name} 分數:</span>
                    <input 
                      type="number" 
                      min="0" max="100"
                      className="w-20 bg-white border border-indigo-200 rounded-lg px-3 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      value={primaryOrgan.score}
                      onChange={(e) => setPrimaryOrgan({ ...primaryOrgan, score: Number(e.target.value) })}
                    />
                    <span className="text-xs text-indigo-500">{getScoreStatus(primaryOrgan.score)}</span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">其他臟腑問題 (可多選)</label>
                <div className="flex flex-wrap gap-2 mb-4">
                  {ORGANS.map(organ => (
                    <button
                      key={organ}
                      disabled={primaryOrgan?.name === organ}
                      onClick={() => {
                        if (otherOrgans.find(o => o.name === organ)) {
                          setOtherOrgans(otherOrgans.filter(o => o.name !== organ));
                        } else {
                          setOtherOrgans([...otherOrgans, { name: organ, score: 80 }]);
                        }
                      }}
                      className={`px-4 py-2 rounded-xl text-sm transition-all border ${
                        otherOrgans.find(o => o.name === organ) 
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' 
                        : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'
                      } disabled:opacity-30`}
                    >
                      {organ}
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  {otherOrgans.map(organ => (
                    <div key={organ.name} className="bg-slate-50 p-3 rounded-xl flex items-center gap-4">
                      <span className="text-sm font-medium text-slate-700 w-24">{organ.name} 分數:</span>
                      <input 
                        type="number" 
                        min="0" max="100"
                        className="w-20 bg-white border border-slate-200 rounded-lg px-3 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                        value={organ.score}
                        onChange={(e) => setOtherOrgans(otherOrgans.map(o => o.name === organ.name ? { ...o, score: Number(e.target.value) } : o))}
                      />
                      <span className="text-xs text-slate-400">{getScoreStatus(organ.score)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">體質類型 (可多選)</label>
                <div className="flex flex-wrap gap-2 mb-4">
                  {CONSTITUTIONS.map(cons => (
                    <button
                      key={cons}
                      onClick={() => {
                        if (selectedConstitutions.find(c => c.name === cons)) {
                          setSelectedConstitutions(selectedConstitutions.filter(c => c.name !== cons));
                        } else {
                          setSelectedConstitutions([...selectedConstitutions, { name: cons, score: 80 }]);
                        }
                      }}
                      className={`px-4 py-2 rounded-xl text-sm transition-all border ${
                        selectedConstitutions.find(c => c.name === cons) 
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' 
                        : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'
                      }`}
                    >
                      {cons}
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  {selectedConstitutions.map(cons => (
                    <div key={cons.name} className="bg-slate-50 p-3 rounded-xl flex items-center gap-4">
                      <span className="text-sm font-medium text-slate-700 w-24">{cons.name} 分數:</span>
                      <input 
                        type="number" 
                        min="0" max="100"
                        className="w-20 bg-white border border-slate-200 rounded-lg px-3 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                        value={cons.score}
                        onChange={(e) => setSelectedConstitutions(selectedConstitutions.map(c => c.name === cons.name ? { ...c, score: Number(e.target.value) } : c))}
                      />
                      <span className="text-xs text-slate-400">{getScoreStatus(cons.score)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={handleGenerateAIReport}
                  disabled={isGenerating}
                  className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-200"
                >
                  {isGenerating ? 'AI 正在思考撰寫中...' : <><Sparkles size={20} /> 呼叫 Gemini 生成報告</>}
                </button>
                {aiReport && (
                  <>
                    <button
                      onClick={handleEmail}
                      className="bg-blue-600 text-white px-6 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
                    >
                      <Mail size={20} /> Email 發送
                    </button>
                    <button
                      onClick={handleDownloadPdf}
                      disabled={isDownloadingPdf}
                      className="bg-slate-800 text-white px-6 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-900 transition-all shadow-lg shadow-slate-200"
                    >
                      <Download size={20} /> {isDownloadingPdf ? 'PDF 生成中...' : '保存為 PDF'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* AI Report Display */}
          <AnimatePresence>
            {aiReport && (
              <motion.section 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white p-10 rounded-3xl shadow-sm border border-slate-100 report-container"
              >
                <div className="max-w-3xl mx-auto">
                  <div className="flex justify-center mb-8">
                    {uploadedLogo ? (
                      <div className="max-w-[200px] max-h-[120px] flex items-center justify-center overflow-hidden">
                        <img 
                          src={uploadedLogo} 
                          alt="Nesture Logo" 
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="w-32 h-32 bg-slate-50 rounded-full flex items-center justify-center border border-dashed border-slate-200">
                        <p className="text-[10px] text-slate-300 uppercase tracking-widest">No Logo</p>
                      </div>
                    )}
                  </div>
                  <h1 className="text-3xl font-bold text-center text-slate-800 mb-2 pb-4 border-b-4 border-orange-600">
                    &lt;Premium定制&gt; 中西醫整合營養調理指南
                  </h1>
                  <p className="text-center text-slate-500 italic mb-10">Integrative Nutrition Premium Action Guide</p>

                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 mb-10">
                    <p className="mb-2">
                      <strong>整體調理策略等級：</strong> 
                      <span style={{ color: aiReport.strategyColor, fontWeight: 'bold' }}>{aiReport.strategyText}</span>
                    </p>
                    <p className="mb-4"><strong>核心診斷摘要：</strong> {aiReport.diagnosisSummary}</p>
                    <p><strong>總體目標：</strong> {aiReport.goal}</p>
                  </div>

                  <h2 className="text-xl font-bold text-indigo-700 bg-indigo-50 p-3 border-l-4 border-indigo-700 mb-4">{aiReport.intro_title}</h2>
                  
                  <div className="space-y-4 mb-10">
                    {aiReport.intro_paragraphs.map((p: string, i: number) => <p key={i} className="text-slate-700 leading-relaxed">{p}</p>)}
                  </div>

                  <h2 className="text-xl font-bold text-indigo-700 bg-indigo-50 p-3 border-l-4 border-indigo-700 mb-4">第一部分：中西醫整合策略總覽</h2>
                  <div className="overflow-hidden rounded-2xl border border-slate-200 mb-10">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-800 text-white">
                          <th className="p-3 text-left w-1/4">視角</th>
                          <th className="p-3 text-left">分析與對策</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        <tr>
                          <td className="p-3 font-bold bg-slate-50">西醫精準營養</td>
                          <td className="p-3">
                            <p className="mb-2"><strong>問題：</strong> {aiReport.integrative_strategy?.western_analysis || '—'}</p>
                            <p><strong>對策：</strong> {aiReport.integrative_strategy?.western_strategy || '—'}</p>
                          </td>
                        </tr>
                        <tr>
                          <td className="p-3 font-bold bg-slate-50">中醫辨證施治</td>
                          <td className="p-3">
                            <p className="mb-2"><strong>問題：</strong> {aiReport.integrative_strategy?.tcm_analysis || '—'}</p>
                            <p><strong>對策：</strong> {aiReport.integrative_strategy?.tcm_strategy || '—'}</p>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <h2 className="text-xl font-bold text-indigo-700 bg-indigo-50 p-3 border-l-4 border-indigo-700 mb-4">第二部分：行動基礎 — 紅燈與綠燈法則</h2>
                  <p className="mb-6 text-slate-600">任何調理若不停止錯誤的習慣，都將徒勞無功。請嚴格遵守。</p>

                  <h3 className="text-lg font-bold text-red-600 border-b-2 border-red-100 pb-2 mb-4">【紅燈區：嚴格禁止】(Stop List)</h3>
                  <div className="space-y-6 mb-10">
                    {aiReport.red_light_items.map((item: any, i: number) => (
                      <div key={i}>
                        <h4 className="font-bold text-red-700 mb-1">🈲 {item.title}：</h4>
                        <ul className="list-disc pl-5 text-slate-700"><li>{item.content}</li></ul>
                      </div>
                    ))}
                  </div>

                  <h3 className="text-lg font-bold text-emerald-600 border-b-2 border-emerald-100 pb-2 mb-4">【綠燈區：核心食材採購指南】(Go List)</h3>
                  <ul className="space-y-2 mb-10">
                    {aiReport.green_light_list.map((item: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-slate-700">
                        <span className="text-emerald-500 font-bold">✅</span> {item}
                      </li>
                    ))}
                  </ul>

                  <h2 className="text-xl font-bold text-indigo-700 bg-indigo-50 p-3 border-l-4 border-indigo-700 mb-4">第三部分：關鍵飲食執行規則</h2>
                  <div className="space-y-6 mb-10">
                    {aiReport.diet_rules.map((rule: any, i: number) => (
                      <div key={i}>
                        <h4 className="font-bold text-slate-800 mb-1">{rule.title}</h4>
                        <ul className="list-disc pl-5 text-slate-700"><li>{rule.content}</li></ul>
                      </div>
                    ))}
                  </div>

                  <h2 className="text-xl font-bold text-indigo-700 bg-indigo-50 p-3 border-l-4 border-indigo-700 mb-4">第四部分：生活型態解決方案</h2>
                  <div className="space-y-6 mb-10">
                    {aiReport.lifestyle_solutions.map((item: any, i: number) => (
                      <div key={i}>
                        <h4 className="font-bold text-slate-800 mb-1">{item.title}</h4>
                        <ul className="list-disc pl-5 text-slate-700"><li>{item.content}</li></ul>
                      </div>
                    ))}
                  </div>

                  <h2 className="text-xl font-bold text-indigo-700 bg-indigo-50 p-3 border-l-4 border-indigo-700 mb-4">第五部分：節氣養生指導</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10 pdf-two-col-grid">
                    <div className="bg-orange-50 p-4 rounded-2xl border border-orange-100">
                      <h4 className="font-bold text-orange-800 mb-2">2月 (雨水)</h4>
                      <p className="text-sm text-slate-700">{aiReport.seasonal_guidance.february}</p>
                    </div>
                    <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                      <h4 className="font-bold text-emerald-800 mb-2">3月 (驚蟄/春分)</h4>
                      <p className="text-sm text-slate-700">{aiReport.seasonal_guidance.march}</p>
                    </div>
                  </div>

                  <h2 className="text-xl font-bold text-indigo-700 bg-indigo-50 p-3 border-l-4 border-indigo-700 mb-4">第六部分：兩週中醫推介餐單</h2>
                  {Object.entries(aiReport.two_week_menu).map(([week, days]: [string, any]) => (
                    <div key={week} className="mb-8">
                      <h3 className="text-lg font-bold text-slate-800 mb-3">{week}</h3>
                      <div className="overflow-hidden rounded-2xl border border-slate-200">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-slate-800 text-white">
                              <th className="p-3 text-left w-16">天數</th>
                              <th className="p-3 text-left">早餐</th>
                              <th className="p-3 text-left">午餐</th>
                              <th className="p-3 text-left">晚餐</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {Object.entries(days).map(([day, meals]: [string, any]) => (
                              <tr key={day} className="hover:bg-slate-50 transition-colors">
                                <td className="p-3 font-bold text-orange-700">{day}</td>
                                <td className="p-3 text-slate-700">
                                  {typeof meals.早餐 === 'object' ? (
                                    <>
                                      <div>{meals.早餐.內容}</div>
                                      <div className="text-[10px] text-slate-400 mt-1 font-mono">{meals.早餐.熱量}</div>
                                    </>
                                  ) : (
                                    meals.早餐
                                  )}
                                </td>
                                <td className="p-3 text-slate-700">
                                  {typeof meals.午餐 === 'object' ? (
                                    <>
                                      <div>{meals.午餐.內容}</div>
                                      <div className="text-[10px] text-slate-400 mt-1 font-mono">{meals.午餐.熱量}</div>
                                    </>
                                  ) : (
                                    meals.午餐
                                  )}
                                </td>
                                <td className="p-3 text-slate-700">
                                  {typeof meals.晚餐 === 'object' ? (
                                    <>
                                      <div>{meals.晚餐.內容}</div>
                                      <div className="text-[10px] text-slate-400 mt-1 font-mono">{meals.晚餐.熱量}</div>
                                    </>
                                  ) : (
                                    meals.晚餐
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}

                  <div className="text-center pt-10 border-t-2 border-orange-100 mb-10">
                    <h3 className="text-lg font-bold text-slate-800 mb-2">結語</h3>
                    <p className="text-slate-600 italic leading-relaxed">{aiReport.conclusion}</p>
                  </div>

                  <h2 className="text-xl font-bold text-indigo-700 bg-indigo-50 p-3 border-l-4 border-indigo-700 mb-4">第七部分：白燕 (Nesture) 產品推介</h2>
                  {aiReport.product_intro && (
                    <p className="mb-6 text-slate-600 italic bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      {aiReport.product_intro}
                    </p>
                  )}
                  <div className="space-y-4">
                    {aiReport.product_recommendations.map((prod: any, i: number) => (
                      <div key={i} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                          <div className="bg-indigo-600 text-white px-3 py-1 rounded-lg text-xs font-bold w-fit">{prod.line}</div>
                          <h4 className="font-bold text-slate-800">{prod.name}</h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pdf-two-col-grid">
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                            <p className="text-xs font-bold text-indigo-600 mb-1 uppercase tracking-wider">匹配理由</p>
                            <p className="text-sm text-slate-700">{prod.reason}</p>
                          </div>
                          <div className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100/50">
                            <p className="text-xs font-bold text-indigo-600 mb-1 uppercase tracking-wider">推介原理</p>
                            <p className="text-sm text-slate-700">{prod.principle}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-16 pt-8 border-t border-slate-200 text-center">
                    <p className="text-xs text-slate-400 leading-relaxed">
                      <strong>免責聲明 (Terms & Conditions)：</strong><br />
                      本報告由 AI 智養師系統根據您提供的數據生成，僅供健康管理與營養調理參考，不作為醫療診斷、處方或治療建議。<br />
                      報告中的建議不能替代專業醫師的診斷。如有任何健康疑慮或正在接受治療，請在執行任何調理計劃前諮詢您的主治醫師。<br />
                      © 2026 白燕 (Nesture) 燕窩養生美顏瓣館. All Rights Reserved.
                    </p>
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

        </div>

        {/* Client Sidebar */}
        <div className="space-y-6">
          <div className="bg-indigo-900 text-white p-8 rounded-3xl shadow-xl">
            <h3 className="text-lg font-bold mb-4">CS Quick Tips</h3>
            <ul className="space-y-3 text-sm text-indigo-100">
              <li className="flex gap-2"><CheckCircle size={16} className="shrink-0 text-indigo-400" /> Review meal photos for hidden sugars.</li>
              <li className="flex gap-2"><CheckCircle size={16} className="shrink-0 text-indigo-400" /> Check sleep times for Liver health.</li>
              <li className="flex gap-2"><CheckCircle size={16} className="shrink-0 text-indigo-400" /> Monitor coffee intake for Yin deficiency.</li>
            </ul>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
