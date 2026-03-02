const DEFAULT_MODEL = 'qwen3.5-flash';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MAX_OUTPUT_TOKENS = 10000;
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;

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

function getBrowserApiKey(): string {
  const key = import.meta.env.VITE_QWEN_API_KEY?.trim();
  if (!key) {
    throw new Error('未設定 VITE_QWEN_API_KEY，請在 .env 設定後重啟前端。');
  }
  return key;
}

function getBaseUrl(): string {
  const raw = import.meta.env.VITE_QWEN_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

function shouldLogQwenDebug(): boolean {
  const flag = import.meta.env.VITE_QWEN_DEBUG?.trim().toLowerCase();
  if (!flag) return true;
  return flag !== 'false' && flag !== '0' && flag !== 'off';
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

function logQwenRawResponse(modelName: string, response: ChatCompletionResponse): void {
  if (!shouldLogQwenDebug()) return;
  const finishReason = response?.choices?.[0]?.finish_reason || 'UNKNOWN';
  console.groupCollapsed(`[Qwen Debug] Raw response (${modelName})`);
  console.log('finishReason:', finishReason);
  console.log('rawText:', extractAssistantText(response));
  console.log('responseObject:', response);
  console.groupEnd();
}

function logQwenParsedResponse(modelName: string, parsed: any): void {
  if (!shouldLogQwenDebug()) return;
  console.groupCollapsed(`[Qwen Debug] Parsed response (${modelName})`);
  console.log('parsedJson:', parsed);
  console.groupEnd();
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
  const apiKey = getBrowserApiKey();
  const endpoint = `${getBaseUrl()}/chat/completions`;
  const modelName = model || import.meta.env.VITE_QWEN_MODEL || DEFAULT_MODEL;
  const maxOutputTokens = parsePositiveInt(
    import.meta.env.VITE_QWEN_MAX_OUTPUT_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS
  );
  const requestTimeoutMs = parsePositiveInt(
    import.meta.env.VITE_QWEN_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, requestTimeoutMs);

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

      if (shouldLogQwenDebug()) {
        console.warn('[Qwen Debug] response_format unsupported, retrying without it.', error);
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
      throw new Error(`AI 生成超時（${Math.floor(requestTimeoutMs / 1000)}秒），請重試。`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  logQwenRawResponse(modelName, response);

  try {
    const parsed = parseJsonText(extractAssistantText(response));
    logQwenParsedResponse(modelName, parsed);
    return parsed;
  } catch (error) {
    const finishReason = response?.choices?.[0]?.finish_reason;
    if (shouldLogQwenDebug()) {
      console.error('[Qwen Debug] Parse failed:', {
        model: modelName,
        finishReason,
        rawText: extractAssistantText(response),
        error,
      });
    }
    if (finishReason === 'length') {
      throw new Error('AI 輸出被截斷（超出 token 限制），請重試。');
    }
    throw error;
  }
}
