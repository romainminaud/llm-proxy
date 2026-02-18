# LLM Proxy

A production-ready proxy server for intercepting, logging, analyzing, and replaying LLM API requests. Supports OpenAI, Anthropic, and Google Gemini. Includes a React dashboard for monitoring usage, costs, and performance.

## Features

- **Multi-Provider Support**: Proxy OpenAI, Anthropic, and Google Gemini APIs
- **Request Logging**: Captures all API requests with full request/response bodies
- **Token Tracking**: Monitors input, output, cached, and cache-write tokens
- **Cost Calculation**: Calculates costs with prompt caching awareness
- **Request Replay**: Re-execute logged requests with modified parameters
- **Multi-Model Comparison**: Compare responses across different models
- **Dashboard**: React UI for browsing requests, viewing statistics, and exporting data
- **SQLite Database**: Production-ready persistent storage with migrations

## Deploy

[![Deploy to DigitalOcean](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/YOUR_USERNAME/proxy/tree/main)

> Replace `YOUR_USERNAME` with your GitHub username after forking. See [DEPLOY.md](DEPLOY.md) for more options.

## Quick Start

### Using Docker (Recommended)

```bash
docker compose up -d
```

- API Server: http://localhost:8090
- Dashboard: http://localhost:3000

### Local Development

```bash
# Install dependencies
cd server && npm install
cd ../frontend && npm install

# Start both (from root)
npm run dev
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8090` | API server port |
| `NODE_ENV` | `development` | Environment (`development`, `production`, `test`) |
| `LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`) |
| `LLM_PROXY_DATA_DIR` | `./data` | Data directory for database |
| `LLM_PROXY_DATABASE_PATH` | `./data/llm-proxy.db` | SQLite database path |
| `OPENAI_API_BASE_URL` | `https://api.openai.com` | OpenAI API base URL |
| `ANTHROPIC_API_BASE_URL` | `https://api.anthropic.com` | Anthropic API base URL |
| `GEMINI_API_BASE_URL` | `https://generativelanguage.googleapis.com` | Gemini API base URL |
| `TRUST_PROXY` | `false` | Trust X-Forwarded-For headers |
| `CORS_ORIGIN` | `*` | CORS allowed origins |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | `1000` | Max requests per window |

### Config File

Create `llm-proxy.config.json` in the project root:

```json
{
  "port": 8090,
  "dataDir": "./data",
  "databasePath": "./data/llm-proxy.db",
  "openaiBaseUrl": "https://api.openai.com",
  "anthropicBaseUrl": "https://api.anthropic.com",
  "geminiBaseUrl": "https://generativelanguage.googleapis.com",
  "pricingOverrides": {
    "custom-model": {
      "input": 5.00,
      "output": 15.00,
      "cached": 0.50
    }
  }
}
```

## Usage

### Configure Your LLM Clients

**OpenAI:**
```bash
export OPENAI_BASE_URL=http://localhost:8090/v1
```

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8090/v1")
```

**Anthropic:**
```python
from anthropic import Anthropic
client = Anthropic(base_url="http://localhost:8090/anthropic")
```

**Gemini:**
```bash
# Use the proxy URL as the API endpoint
http://localhost:8090/gemini/v1beta/models/gemini-pro:generateContent
```

## API Endpoints

### Proxy Routes
- `POST /v1/*` - OpenAI API proxy
- `POST /anthropic/*` - Anthropic API proxy
- `POST /gemini/*` - Google Gemini API proxy

### Dashboard API
- `GET /api/requests` - List requests (`?model=`, `?limit=`, `?offset=`)
- `GET /api/requests/:id` - Get request details
- `DELETE /api/requests/:id` - Delete a request
- `DELETE /api/requests` - Clear all requests
- `GET /api/stats` - Aggregated statistics
- `POST /api/replay/:id` - Replay a request
- `POST /api/compare` - Multi-model comparison

### Health Checks
- `GET /health` - Liveness check
- `GET /ready` - Readiness check

## Deployment

See [DEPLOY.md](./DEPLOY.md) for detailed deployment instructions.

### Quick Docker Deployment

```bash
# Build and run
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

### Production Deployment

```bash
# Use production overrides
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Project Structure

```
proxy/
├── server/                 # Express.js API server
│   ├── src/
│   │   ├── server.ts       # Main server with middleware
│   │   ├── database.ts     # SQLite initialization & migrations
│   │   ├── db.ts           # Database operations
│   │   ├── config.ts       # Configuration management
│   │   ├── logger.ts       # Structured logging
│   │   ├── pricing.ts      # Model pricing data
│   │   ├── providers.ts    # Multi-provider support
│   │   └── routes/         # API route handlers
│   └── data/               # SQLite database
│
├── frontend/               # React + Vite dashboard
│   └── src/
│       ├── pages/          # Page components
│       ├── components/     # UI components
│       └── context/        # React context
│
├── scripts/                # Deployment scripts
├── Dockerfile              # Multi-stage Docker build
├── docker-compose.yml      # Docker Compose config
└── docker-compose.prod.yml # Production overrides
```

## Testing

```bash
cd server && npm test
```

## License

MIT
