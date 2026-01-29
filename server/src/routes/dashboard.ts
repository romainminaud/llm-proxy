import { Router, type Request, type Response } from 'express';
import { getRequests, getRequest, getStats, deleteRequest, clearAll } from '../db.js';
import { getProvidersInfo } from '../providers.js';

const router = Router();

router.get('/api/requests', (_req: Request, res: Response) => {
  const { limit, offset, model } = _req.query as { limit?: string; offset?: string; model?: string };
  const requests = getRequests({
    limit: limit ? parseInt(limit) : 100,
    offset: offset ? parseInt(offset) : 0,
    model: model || null,
  });
  res.json(requests);
});

router.get('/api/requests/:id', (req: Request, res: Response) => {
  const request = getRequest(req.params.id);
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  res.json(request);
});

router.get('/api/stats', (_req: Request, res: Response) => {
  const stats = getStats();
  res.json(stats);
});

router.delete('/api/requests/:id', (req: Request, res: Response) => {
  deleteRequest(req.params.id);
  res.json({ success: true });
});

router.delete('/api/requests', (_req: Request, res: Response) => {
  clearAll();
  res.json({ success: true });
});

router.get('/api/providers', (_req: Request, res: Response) => {
  res.json(getProvidersInfo());
});

export default router;
