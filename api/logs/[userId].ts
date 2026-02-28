import { methodNotAllowed, sendError } from '../_lib/http.js';
import { getLogsForUser } from '../_lib/store.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  const userId = Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId path parameter.' });
  }

  try {
    const logs = await getLogsForUser(userId);
    res.status(200).json(logs);
  } catch (error) {
    sendError(res, error);
  }
}
