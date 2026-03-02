import { setupDevProxyForAi } from './devProxy.js';

const DEFAULT_MODEL = 'qwen3.5-flash';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 10000;
setupDevProxyForAi();

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

class AiTimeoutError extends Error {
  code: string;

  constructor(timeoutMs: number) {
    super(`AI request timed out after ${timeoutMs}ms.`);
    this.name = 'AiTimeoutError';
    this.code = 'AI_TIMEOUT';
  }
}

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

  throw new Error('AI response is not valid JSON.');
}

function extractAssistantText(response: ChatCompletionResponse): string {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }

  return '';
}

function extractApiErrorMessage(payload: any): string | null {
  const nested = payload?.error?.message;
  if (typeof nested === 'string' && nested.trim()) {
    return nested.trim();
  }
  return null;
}

function isResponseFormatNotSupported(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('response_format') || message.includes('json_object');
}

async function requestCompletion(params: {
  endpoint: string;
  apiKey: string;
  modelName: string;
  prompt: string;
  maxOutputTokens: number;
  signal: AbortSignal;
  includeJsonResponseFormat: boolean;
}): Promise<ChatCompletionResponse> {
  const body: Record<string, any> = {
    model: params.modelName,
    messages: [{ role: 'user', content: params.prompt }],
    temperature: 0.2,
    max_tokens: params.maxOutputTokens,
    stream: false,
  };

  if (params.includeJsonResponseFormat) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(params.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorMessage = extractApiErrorMessage(payload);
    const err = new Error(
      errorMessage
        ? `[${response.status}] ${errorMessage}`
        : `AI request failed with HTTP ${response.status}.`
    );
    (err as any).status = response.status;
    (err as any).payload = payload;
    throw err;
  }

  return (payload || {}) as ChatCompletionResponse;
}

export async function generateReportFromPrompt(prompt: string, model?: string): Promise<any> {
  const apiKey = process.env.QWEN_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing QWEN_API_KEY environment variable.');
  }

  const baseUrl = (process.env.QWEN_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const modelName = model || process.env.QWEN_MODEL || DEFAULT_MODEL;

  const requestTimeoutMs = parsePositiveInt(
    process.env.QWEN_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS
  );
  const maxOutputTokens = parsePositiveInt(
    process.env.QWEN_MAX_OUTPUT_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, requestTimeoutMs);

  const endpoint = `${baseUrl}/chat/completions`;
  let response: ChatCompletionResponse;
  try {
    try {
      response = await requestCompletion({
        endpoint,
        apiKey,
        modelName,
        prompt,
        maxOutputTokens,
        signal: controller.signal,
        includeJsonResponseFormat: true,
      });
    } catch (error) {
      if (!isResponseFormatNotSupported(error)) {
        throw error;
      }

      response = await requestCompletion({
        endpoint,
        apiKey,
        modelName,
        prompt,
        maxOutputTokens,
        signal: controller.signal,
        includeJsonResponseFormat: false,
      });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AiTimeoutError(requestTimeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  try {
    return parseJsonText(extractAssistantText(response));
  } catch (error) {
    const finishReason = response?.choices?.[0]?.finish_reason;
    if (finishReason === 'length') {
      const err = new Error('AI output was truncated due to token limit.');
      (err as any).code = 'AI_OUTPUT_TRUNCATED';
      throw err;
    }
    throw error;
  }
}
