import { GoogleGenAI } from '@google/genai';
import { setupDevProxyForGemini } from './devProxy';

const DEFAULT_MODEL = 'gemini-2.5-flash';
setupDevProxyForGemini();

function parseJsonText(raw: string): any {
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

export async function generateReportFromPrompt(prompt: string, model?: string): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY environment variable.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: model || process.env.GEMINI_MODEL || DEFAULT_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  return parseJsonText(response.text || '{}');
}
