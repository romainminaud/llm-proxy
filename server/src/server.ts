import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger } from './logger.js';
import { closeDatabase } from './database.js';
import dashboardRouter from './routes/dashboard.js';
import replayRouter from './routes/replay.js';
import compareRouter from './routes/compare.js';
import proxyRouter from './routes/proxy.js';

// Import db to initialize database on startup
import './db.js';

const app = express();
const PORT = config.port;

// Trust proxy when behind reverse proxy (nginx, load balancer)
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// Security headers
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  if (config.nodeEnv === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Simple rate limiting (per IP)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

app.use((req: Request, res: Response, next: NextFunction) => {
  // Skip rate limiting for health checks
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + config.rateLimitWindowMs });
    return next();
  }

  if (record.count >= config.rateLimitMaxRequests) {
    res.setHeader('Retry-After', Math.ceil((record.resetTime - now) / 1000).toString());
    return res.status(429).json({ error: 'Too many requests' });
  }

  record.count++;
  next();
});

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);

// Parse JSON bodies with large limit for LLM requests
app.use(express.json({ limit: '50mb' }));

// CORS for dashboard
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', config.corsOrigin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (_req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Health check endpoints
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/ready', (_req: Request, res: Response) => {
  res.json({ status: 'ready', timestamp: new Date().toISOString() });
});

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.request(req.method, req.path, res.statusCode, duration);
  });
  next();
});

// Mount routes
app.use(dashboardRouter);
app.use(replayRouter);
app.use(compareRouter);
app.use(proxyRouter);

// Serve frontend static files if built (single-port mode for App Platform / production)
const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDist = join(__dirname, '../../frontend/dist');
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(join(frontendDist, 'index.html'));
  });
}

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

export { app };

let server: ReturnType<typeof app.listen> | null = null;

function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
      closeDatabase();
      process.exit(0);
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      closeDatabase();
      process.exit(1);
    }, 30000);
  } else {
    closeDatabase();
    process.exit(0);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  server = app.listen(PORT, () => {
    logger.info(`LLM Proxy Interceptor started`, {
      port: PORT,
      env: config.nodeEnv,
      openaiProxy: `http://localhost:${PORT}/v1`,
      anthropicProxy: `http://localhost:${PORT}/anthropic`,
    });

    if (config.nodeEnv !== 'production') {
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
    }
  });

  // Graceful shutdown handlers
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
