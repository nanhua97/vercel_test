import { GoogleGenAI } from '@google/genai';
import { setupDevProxyForGemini } from './devProxy.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 3000;
setupDevProxyForGemini();

class GeminiTimeoutError extends Error {
  code: string;

  constructor(timeoutMs: number) {
    super(`Gemini request timed out after ${timeoutMs}ms.`);
    this.name = 'GeminiTimeoutError';
    this.code = 'GEMINI_TIMEOUT';
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
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
  const trimmed = raw.trim();
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

export async function generateReportFromPrompt(prompt: string, model?: string): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY environment variable.');
  }

  const requestTimeoutMs = parsePositiveInt(
    process.env.GEMINI_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS
  );
  const maxOutputTokens = parsePositiveInt(
    process.env.GEMINI_MAX_OUTPUT_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, requestTimeoutMs);

  const ai = new GoogleGenAI({ apiKey });
  let response;
  try {
    response = await ai.models.generateContent({
      model: model || process.env.GEMINI_MODEL || DEFAULT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens,
        httpOptions: { timeout: requestTimeoutMs },
        abortSignal: controller.signal,
      },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new GeminiTimeoutError(requestTimeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  return parseJsonText(response.text || '{}');
}
