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
| `LLM_PROXY_SAVE_REQUEST_JSON` | `true` | Also write each request as a JSON file (set `false` for DB only) |
| `LLM_PROXY_REQUEST_JSON_DIR` | `./data/requests` | Directory for the per-request JSON files |
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
  "saveRequestJson": true,
  "requestJsonDir": "./data/requests",
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

### Model Pricing

All model pricing (per 1M tokens, USD) lives in a single file: `server/src/model-pricing.json`. To update prices or add a model, edit that file — no code changes needed. The `models` map holds per-model rates and `default` is the fallback for unknown models.

At runtime you can still override individual models without touching that file, via `pricingOverrides` (or replace entries wholesale via `pricing`) in `llm-proxy.config.json`.

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

### Session Grouping (Agentic Traffic)

Requests are grouped into **sessions** for the Sessions view. The session id is resolved in priority order:

1. **`x-llm-proxy-session-id` header** — vendor-agnostic, works with any provider or agent framework. The proxy consumes it and never forwards it upstream. Optionally add `x-llm-proxy-agent: <name>/<version>` to label the agent.
2. **Claude Code metadata** — Claude Code's session id is picked up automatically from `metadata.user_id` (Anthropic requests), no configuration needed.
3. **Conversation-prefix hash** — fallback: requests sharing a system prompt + first user message group under a `h:`-prefixed heuristic session.

```python
# Any OpenAI-compatible client
client = OpenAI(
    base_url="http://localhost:8090/v1",
    default_headers={
        "x-llm-proxy-session-id": "task-42",
        "x-llm-proxy-agent": "my-agent/1.0.0",
    },
)
```

```bash
# Claude Code (session id is automatic; header only needed for custom labels)
export ANTHROPIC_BASE_URL=http://localhost:8090/anthropic
export ANTHROPIC_CUSTOM_HEADERS="x-llm-proxy-agent: nightly-runner/1.0"
```

## API Endpoints

### Proxy Routes
- `POST /v1/*` - OpenAI API proxy
- `POST /anthropic/*` - Anthropic API proxy
- `POST /gemini/*` - Google Gemini API proxy

### Dashboard API
- `GET /api/requests` - List requests (`?model=`, `?provider=`, `?session_id=`, `?limit=`, `?offset=`; total in `X-Total-Count`)
- `GET /api/requests/:id` - Get request details
- `GET /api/sessions` - Per-session rollups (tokens by class, cache hit ratio, cost, tool calls)
- `GET /api/sessions/:id` - Session turn timeline (`?insights=1` adds context attribution + cache warnings)
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
│   │   ├── pricing.ts      # Cost calculation logic
│   │   ├── model-pricing.json # Model pricing data (single source of truth)
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
