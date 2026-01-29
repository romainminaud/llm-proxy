# LLM Proxy

A proxy server for intercepting, logging, analyzing, and replaying OpenAI API requests. Includes a React dashboard for monitoring usage, costs, and performance.

## Features

- **Request Logging**: Captures all OpenAI API requests with full request/response bodies
- **Token Tracking**: Monitors input, output, and cached tokens
- **Cost Calculation**: Calculates costs with prompt caching awareness
- **Request Replay**: Re-execute logged requests with modified parameters
- **Dashboard**: React UI for browsing requests, viewing statistics, and exporting data

## Project Structure

```
proxy/
├── server/           # Express.js proxy server
│   ├── src/
│   │   ├── server.ts   # Main proxy and API routes
│   │   ├── db.ts       # File-based request storage
│   │   ├── pricing.ts  # OpenAI model pricing
│   │   └── types.ts    # TypeScript types
│   └── data/           # Stored request logs (JSON)
│
├── frontend/         # React + Vite dashboard
│   └── src/
│       ├── App.tsx
│       └── components/
│
└── package.json
```

## Setup

Install dependencies:

```bash
# Install server dependencies
cd server && npm install

# Install frontend dependencies
cd frontend && npm install
```

## Usage

### Start the proxy server

```bash
cd server && npm start
```

The proxy runs on `http://localhost:8090`.

### Start the dashboard

```bash
cd frontend && npm run dev
```

The dashboard runs on `http://localhost:5173`.

### Configure your OpenAI client

Point your OpenAI client to the proxy:

```bash
export OPENAI_BASE_URL=http://localhost:8090/v1
```

Or in code:

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8090/v1")
```

All requests will be logged and viewable in the dashboard.

## API Endpoints

### Proxy

- `POST /v1/*` - Forwards requests to OpenAI API and logs them

### Dashboard API

- `GET /api/requests` - List logged requests (supports `?model=` filter)
- `GET /api/requests/:id` - Get request details
- `DELETE /api/requests/:id` - Delete a request
- `DELETE /api/requests` - Clear all requests
- `GET /api/stats` - Get aggregated statistics
- `POST /api/replay/:id` - Replay a request (requires `x-openai-api-key` header)

## Dashboard Features

- **Stats Cards**: View total requests, tokens, and costs
- **Request Table**: Browse all logged requests with filtering
- **Request Detail**: View full conversation with message breakdown
- **Replay**: Re-run requests with modifications and compare results
- **Export**: Download requests and stats as CSV

## Configuration

Create a `llm-proxy.config.json` file in the project root (or `.llm-proxy.json`):

```json
{
  "port": 8090,
  "dataDir": "./data/requests",
  "openaiBaseUrl": "https://api.openai.com",
  "pricingOverrides": {
    "custom-model": {
      "input": 5.00,
      "output": 15.00,
      "cached": 0.50
    }
  }
}
```

Environment variables take precedence over config file:
- `PORT` - Server port
- `LLM_PROXY_DATA_DIR` - Data storage directory
- `OPENAI_API_BASE_URL` - OpenAI API base URL

## Docker

Build and run with Docker:

```bash
docker build -t llm-proxy .
docker run -p 8090:8090 -p 3000:3000 -v ./data:/app/server/data/requests llm-proxy
```

Or use Docker Compose:

```bash
docker-compose up -d
```

## Testing

Run the test suite:

```bash
cd server && npm test
```
