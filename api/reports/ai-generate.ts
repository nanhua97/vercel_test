import { generateReportFromPrompt } from '../_lib/gemini.js';
import { methodNotAllowed, readJsonBody, sendError } from '../_lib/http.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    const body = readJsonBody<{ prompt?: string; model?: string }>(req);
    const prompt = body.prompt?.trim();

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required.' });
    }

    const report = await generateReportFromPrompt(prompt, body.model);
    res.status(200).json(report);
  } catch (error) {
    sendError(res, error);
  }
}
