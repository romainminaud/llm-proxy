import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import dashboardRouter from './routes/dashboard.js';
import replayRouter from './routes/replay.js';
import proxyRouter from './routes/proxy.js';

const app = express();
const PORT = config.port;

// Parse JSON bodies with large limit for LLM requests
app.use(express.json({ limit: '50mb' }));

// CORS for dashboard
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (_req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Mount routes
app.use(dashboardRouter);
app.use(replayRouter);
app.use(proxyRouter);

export { app };

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    LLM Proxy Interceptor                      ║
╠═══════════════════════════════════════════════════════════════╣
║  API Server:           http://localhost:${PORT}                  ║
║                                                               ║
║  OpenAI proxy:         http://localhost:${PORT}/v1               ║
║  Anthropic proxy:      http://localhost:${PORT}/anthropic        ║
║                                                               ║
║  Usage:                                                       ║
║  - OpenAI: Set OPENAI_BASE_URL=http://localhost:${PORT}/v1       ║
║  - Anthropic: Set base URL to http://localhost:${PORT}/anthropic ║
║                                                               ║
║  Run frontend: cd frontend && npm run dev                     ║
╚═══════════════════════════════════════════════════════════════╝
    `);
  });
}
