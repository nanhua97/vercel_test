export function readJsonBody<T = any>(req: any): T {
  if (!req?.body) {
    return {} as T;
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as T;
    } catch {
      return {} as T;
    }
  }

  return req.body as T;
}

export function methodNotAllowed(res: any, allowed: string[]): void {
  res.setHeader('Allow', allowed.join(', '));
  res.status(405).json({ error: `Method not allowed. Use: ${allowed.join(', ')}` });
}

export function sendError(res: any, error: unknown): void {
  let message = error instanceof Error ? error.message : 'Unexpected server error';
  const causeCode = (error as any)?.cause?.code;
  const errorCode = (error as any)?.code;

  if (errorCode === 'GEMINI_TIMEOUT') {
    message = 'AI 生成超時（45秒）。請重試，或縮減輸入內容後再生成。';
  } else if (errorCode === 'GEMINI_OUTPUT_TRUNCATED') {
    message = 'AI 輸出被截斷（超出 token 限制）。系統已要求精簡輸出，請重試。';
  } else if (message.includes('Gemini response is not valid JSON')) {
    message = 'AI 返回了非標準 JSON。請重試一次，若仍失敗請稍後再試。';
  } else if (causeCode === 'UND_ERR_CONNECT_TIMEOUT') {
    message = 'Unable to reach Gemini API (network timeout). Please check outbound network access and try again.';
  } else if (causeCode === 'ENOTFOUND') {
    message = 'Unable to resolve Gemini API host (DNS failure). Please check your network/DNS settings.';
  } else if (causeCode === 'ECONNREFUSED') {
    message = 'Connection to Gemini API was refused. Please check network proxy or firewall settings.';
  }

  const trimmed = message.trim();
  if (trimmed.startsWith('{') && trimmed.includes('"error"')) {
    try {
      const parsed = JSON.parse(trimmed);
      const nested = parsed?.error?.message;
      if (typeof nested === 'string' && nested.trim()) {
        message = nested;
      }
    } catch {
      // Keep original message if parsing fails.
    }
  }

  res.status(500).json({ error: message });
}
