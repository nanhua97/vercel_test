import { methodNotAllowed, sendError } from './_lib/http';
import { getClients } from './_lib/store';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  try {
    const clients = await getClients();
    res.status(200).json(clients);
  } catch (error) {
    sendError(res, error);
  }
}
