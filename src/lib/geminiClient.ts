import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_MAX_OUTPUT_TOKENS = 10000;

const DAY_MEAL_SCHEMA = {
  type: 'object',
  required: ['內容', '熱量'],
  additionalProperties: false,
  properties: {
    內容: { type: 'string' },
    熱量: { type: 'string' },
  },
} as const;

const DAY_MENU_SCHEMA = {
  type: 'object',
  required: ['早餐', '午餐', '晚餐'],
  additionalProperties: false,
  properties: {
    早餐: DAY_MEAL_SCHEMA,
    午餐: DAY_MEAL_SCHEMA,
    晚餐: DAY_MEAL_SCHEMA,
  },
} as const;

function buildWeekMenuSchema(startDay: number, endDay: number) {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (let day = startDay; day <= endDay; day += 1) {
    const key = `Day ${day}`;
    properties[key] = DAY_MENU_SCHEMA;
    required.push(key);
  }
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

const REPORT_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  required: [
    'goal',
    'intro_title',
    'intro_paragraphs',
    'integrative_strategy',
    'red_light_items',
    'green_light_list',
    'diet_rules',
    'lifestyle_solutions',
    'seasonal_guidance',
    'two_week_menu',
    'product_intro',
    'product_recommendations',
    'conclusion',
  ],
  additionalProperties: false,
  properties: {
    goal: { type: 'string' },
    intro_title: { type: 'string' },
    intro_paragraphs: { type: 'array', items: { type: 'string' }, minItems: 1 },
    integrative_strategy: {
      type: 'object',
      required: ['western_analysis', 'western_strategy', 'tcm_analysis', 'tcm_strategy'],
      additionalProperties: false,
      properties: {
        western_analysis: { type: 'string' },
        western_strategy: { type: 'string' },
        tcm_analysis: { type: 'string' },
        tcm_strategy: { type: 'string' },
      },
    },
    red_light_items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'content'],
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
    green_light_list: { type: 'array', items: { type: 'string' } },
    diet_rules: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'content'],
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
    lifestyle_solutions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'content'],
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
    seasonal_guidance: {
      type: 'object',
      required: ['february', 'march'],
      additionalProperties: false,
      properties: {
        february: { type: 'string' },
        march: { type: 'string' },
      },
    },
    two_week_menu: {
      type: 'object',
      required: ['Week 1 (啟動期)', 'Week 2 (鞏固期)'],
      additionalProperties: false,
      properties: {
        'Week 1 (啟動期)': buildWeekMenuSchema(1, 7),
        'Week 2 (鞏固期)': buildWeekMenuSchema(8, 14),
      },
    },
    product_intro: { type: 'string' },
    product_recommendations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['line', 'name', 'reason', 'principle'],
        additionalProperties: false,
        properties: {
          line: { type: 'string' },
          name: { type: 'string' },
          reason: { type: 'string' },
          principle: { type: 'string' },
        },
      },
    },
    conclusion: { type: 'string' },
  },
} as const;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeJsonCandidate(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

function tryParseJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findBalancedJsonSlice(input: string, startIndex: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < input.length; i += 1) {
    const ch = input[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }

    if (ch === '}' || ch === ']') {
      if (!stack.length) {
        return null;
      }

      const last = stack[stack.length - 1];
      const isMatch = (last === '{' && ch === '}') || (last === '[' && ch === ']');
      if (!isMatch) {
        return null;
      }

      stack.pop();
      if (!stack.length) {
        return input.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function extractFirstParsableJson(input: string): any | null {
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch !== '{' && ch !== '[') {
      continue;
    }

    const slice = findBalancedJsonSlice(input, i);
    if (!slice) {
      continue;
    }

    const parsed = tryParseJson(slice);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function parseJsonText(raw: string): any {
  const trimmed = normalizeJsonCandidate(raw);
  if (!trimmed) {
    return {};
  }

  const direct = tryParseJson(trimmed);
  if (direct !== null) {
    return direct;
  }

  const withoutFences = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  if (withoutFences) {
    const fencedParsed = tryParseJson(withoutFences);
    if (fencedParsed !== null) {
      return fencedParsed;
    }
  }

  const extractedFromFenced = extractFirstParsableJson(withoutFences || trimmed);
  if (extractedFromFenced !== null) {
    return extractedFromFenced;
  }

  const extractedFromRaw = extractFirstParsableJson(trimmed);
  if (extractedFromRaw !== null) {
    return extractedFromRaw;
  }

  throw new Error('Gemini response is not valid JSON.');
}

function getBrowserApiKey(): string {
  const key = import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      '未設定 VITE_GEMINI_API_KEY，請在 .env 設定後重啟前端。'
    );
  }
  return key;
}

function shouldLogGeminiDebug(): boolean {
  const flag = import.meta.env.VITE_GEMINI_DEBUG?.trim().toLowerCase();
  if (!flag) return true;
  return flag !== 'false' && flag !== '0' && flag !== 'off';
}

function logGeminiRawResponse(modelName: string, response: any): void {
  if (!shouldLogGeminiDebug()) return;
  const finishReason = response?.candidates?.[0]?.finishReason || 'UNKNOWN';
  console.groupCollapsed(`[Gemini Debug] Raw response (${modelName})`);
  console.log('finishReason:', finishReason);
  console.log('rawText:', response?.text || '');
  console.log('responseObject:', response);
  console.groupEnd();
}

function logGeminiParsedResponse(modelName: string, parsed: any): void {
  if (!shouldLogGeminiDebug()) return;
  console.groupCollapsed(`[Gemini Debug] Parsed response (${modelName})`);
  console.log('parsedJson:', parsed);
  console.groupEnd();
}

export async function generateReportFromPrompt(prompt: string, model?: string): Promise<any> {
  const apiKey = getBrowserApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const maxOutputTokens = parsePositiveInt(
    import.meta.env.VITE_GEMINI_MAX_OUTPUT_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS
  );
  const modelName = model || import.meta.env.VITE_GEMINI_MODEL || DEFAULT_MODEL;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: REPORT_RESPONSE_JSON_SCHEMA,
      maxOutputTokens,
    },
  });
  logGeminiRawResponse(modelName, response);

  try {
    const parsed = parseJsonText(response.text || '{}');
    logGeminiParsedResponse(modelName, parsed);
    return parsed;
  } catch (error) {
    const finishReason = response?.candidates?.[0]?.finishReason;
    if (shouldLogGeminiDebug()) {
      console.error('[Gemini Debug] Parse failed:', {
        model: modelName,
        finishReason,
        rawText: response?.text || '',
        error,
      });
    }
    if (finishReason === 'MAX_TOKENS') {
      throw new Error('AI 輸出被截斷（超出 token 限制），請重試。');
    }
    throw error;
  }
}
