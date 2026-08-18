import { Router, type Request, type Response } from 'express';
import {
  clearAll,
  countRequests,
  countSessions,
  countTurns,
  deleteRequest,
  getRequest,
  getRequests,
  getSessionDetail,
  getSessions,
  getStats,
  getTurnDetail,
  getTurns,
} from '../db.js';
import { computeSessionInsights } from '../insights.js';
import { getProvidersInfo } from '../providers.js';

const router = Router();

router.get('/api/requests', (_req: Request, res: Response) => {
  const { limit, offset, model, provider, session_id } = _req.query as {
    limit?: string;
    offset?: string;
    model?: string;
    provider?: string;
    session_id?: string;
  };
  const filters = {
    model: model || null,
    provider: provider || null,
    sessionId: session_id || null,
  };
  const requests = getRequests({
    limit: limit ? parseInt(limit) : 100,
    offset: offset ? parseInt(offset) : 0,
    ...filters,
  });
  // Response stays a plain array (frontend depends on it); total goes in a header.
  res.setHeader('X-Total-Count', String(countRequests(filters)));
  res.json(requests);
});

router.get('/api/sessions', (req: Request, res: Response) => {
  const { limit, offset } = req.query as { limit?: string; offset?: string };
  const sessions = getSessions({
    limit: limit ? parseInt(limit) : 50,
    offset: offset ? parseInt(offset) : 0,
  });
  res.setHeader('X-Total-Count', String(countSessions()));
  res.json(sessions);
});

router.get('/api/turns', (req: Request, res: Response) => {
  const { limit, offset } = req.query as { limit?: string; offset?: string };
  const turns = getTurns({
    limit: limit ? parseInt(limit) : 100,
    offset: offset ? parseInt(offset) : 0,
  });
  res.setHeader('X-Total-Count', String(countTurns()));
  res.json(turns);
});

router.get('/api/sessions/:id/turns/:turnId', (req: Request, res: Response) => {
  const detail = getTurnDetail(req.params.id, req.params.turnId);
  if (!detail) {
    return res.status(404).json({ error: 'Turn not found' });
  }
  res.json(detail);
});

router.get('/api/sessions/:id', (req: Request, res: Response) => {
  const detail = getSessionDetail(req.params.id);
  if (!detail) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (req.query.insights === '1') {
    // Lazy: loads full bodies, so only on explicit request
    const withBodies = getRequests({ sessionId: req.params.id, limit: 1000 }).reverse();
    return res.json({ ...detail, insights: computeSessionInsights(withBodies) });
  }
  res.json(detail);
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
