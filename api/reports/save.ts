import { methodNotAllowed, readJsonBody, sendError } from '../_lib/http.js';
import { saveReport } from '../_lib/store.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    const body = readJsonBody<{
      client_name?: string;
      client_phone?: string;
      diagnosis?: string;
      content?: unknown;
    }>(req);

    const result = await saveReport({
      client_name: body.client_name || 'Anonymous',
      client_phone: body.client_phone || 'N/A',
      diagnosis: body.diagnosis || 'N/A',
      content: body.content,
    });

    res.status(200).json(result);
  } catch (error) {
    sendError(res, error);
  }
}
