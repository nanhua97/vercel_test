import { methodNotAllowed, sendError } from '../_lib/http.js';
import { getReports } from '../_lib/store.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  try {
    const reports = await getReports();
    res.status(200).json(reports);
  } catch (error) {
    sendError(res, error);
  }
}
