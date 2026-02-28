import { methodNotAllowed, readJsonBody, sendError } from '../_lib/http.js';
import { saveLog } from '../_lib/store.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    const body = readJsonBody(req);
    if (!body.user_id || !body.date) {
      return res.status(400).json({ error: 'user_id and date are required.' });
    }

    const result = await saveLog(body);
    res.status(200).json(result);
  } catch (error) {
    sendError(res, error);
  }
}
