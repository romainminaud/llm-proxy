import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import express from 'express'

// Set up temp data dir before importing the app
const tempDir = mkdtempSync(join(tmpdir(), 'llm-proxy-test-'))
process.env.LLM_PROXY_DATA_DIR = tempDir

// Mock upstream servers
const mockOpenAI = express()
mockOpenAI.use(express.json())
const mockAnthropic = express()
mockAnthropic.use(express.json())

let openaiServer: http.Server
let anthropicServer: http.Server

// Start mock servers and configure env before importing the app
const openaiPort = await new Promise<number>((resolve) => {
  openaiServer = mockOpenAI.listen(0, () => {
    resolve((openaiServer.address() as { port: number }).port)
  })
})
const anthropicPort = await new Promise<number>((resolve) => {
  anthropicServer = mockAnthropic.listen(0, () => {
    resolve((anthropicServer.address() as { port: number }).port)
  })
})

process.env.OPENAI_API_BASE_URL = `http://localhost:${openaiPort}`
process.env.ANTHROPIC_API_BASE_URL = `http://localhost:${anthropicPort}`
process.env.PORT = '0'

// --- Mock OpenAI endpoints ---

mockOpenAI.post('/v1/chat/completions', (req, res) => {
  const model = req.body?.model || 'gpt-4o-mini'
  res.json({
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    model,
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 20 },
    },
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'Hello from mock OpenAI!' },
      finish_reason: 'stop',
    }],
  })
})

mockOpenAI.post('/v1/responses', (req, res) => {
  const model = req.body?.model || 'gpt-4o-mini'
  res.json({
    id: 'resp-mock',
    object: 'response',
    model,
    usage: {
      input_tokens: 80,
      output_tokens: 40,
    },
    output: [{ type: 'message', content: [{ type: 'text', text: 'Hello from mock responses API!' }] }],
  })
})

// --- Mock Anthropic endpoints ---

mockAnthropic.post('/v1/messages', (req, res) => {
  const model = req.body?.model || 'claude-sonnet-4-5-20250929'
  res.json({
    id: 'msg-mock',
    type: 'message',
    role: 'assistant',
    model,
    usage: {
      input_tokens: 150,
      output_tokens: 75,
      cache_read_input_tokens: 22000,
      cache_creation_input_tokens: 0,
    },
    content: [{ type: 'text', text: 'Hello from mock Anthropic!' }],
    stop_reason: 'end_turn',
  })
})

// Now import app (uses the env vars above)
const { app } = await import('../src/server.ts')
const { clearAll, getRequests, getRequest } = await import('../src/db.ts')

// Start the proxy
let proxyServer: http.Server
const proxyPort = await new Promise<number>((resolve) => {
  proxyServer = app.listen(0, () => {
    resolve((proxyServer.address() as { port: number }).port)
  })
})
const base = `http://localhost:${proxyPort}`

// Helper for HTTP requests
async function request(path: string, options: {
  method?: string
  body?: unknown
  headers?: Record<string, string>
} = {}) {
  const { method = 'GET', body, headers = {} } = options
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  return { status: res.status, data }
}

// Wait for async file writes to flush
const wait = (ms = 50) => new Promise(r => setTimeout(r, ms))

// Cleanup
after(() => {
  proxyServer?.close()
  openaiServer?.close()
  anthropicServer?.close()
  rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  clearAll()
})

// --- OpenAI proxy tests ---

test('OpenAI proxy: rejects request without auth', async () => {
  const { status, data } = await request('/v1/chat/completions', {
    method: 'POST',
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
  })
  assert.equal(status, 401)
  assert.ok(data.error)
})

test('OpenAI proxy: forwards chat completion and logs request', async () => {
  const { status, data } = await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-key' },
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
  })

  assert.equal(status, 200)
  assert.equal(data.id, 'chatcmpl-mock')
  assert.equal(data.choices[0].message.content, 'Hello from mock OpenAI!')

  await wait()
  const requests = getRequests({})
  assert.equal(requests.length, 1)

  const saved = requests[0]
  assert.equal(saved.provider, 'openai')
  assert.equal(saved.model, 'gpt-4o-mini')
  assert.equal(saved.status_code, 200)
  assert.equal(saved.output_tokens, 50)
  assert.ok(saved.total_cost! > 0)
  assert.ok(saved.duration_ms! >= 0)
})

test('OpenAI proxy: forwards responses API', async () => {
  const { status, data } = await request('/v1/responses', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-key' },
    body: { model: 'gpt-4o-mini', input: 'hi' },
  })

  assert.equal(status, 200)
  assert.equal(data.id, 'resp-mock')

  await wait()
  const requests = getRequests({})
  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, '/v1/responses')
})

test('OpenAI proxy: handles cached tokens', async () => {
  const { status } = await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-key' },
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
  })

  assert.equal(status, 200)
  await wait()

  const saved = getRequests({})[0]
  assert.equal(saved.cached_tokens, 20)
  assert.ok(saved.cached_cost! >= 0)
})

// --- Anthropic proxy tests ---

test('Anthropic proxy: rejects request without x-api-key', async () => {
  const { status, data } = await request('/anthropic/v1/messages', {
    method: 'POST',
    body: { model: 'claude-sonnet-4-5-20250929', messages: [{ role: 'user', content: 'hi' }] },
  })
  assert.equal(status, 401)
  assert.ok(data.error)
})

test('Anthropic proxy: forwards messages and logs request', async () => {
  const { status, data } = await request('/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': 'test-anthropic-key' },
    body: {
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
    },
  })

  assert.equal(status, 200)
  assert.equal(data.id, 'msg-mock')
  assert.equal(data.content[0].text, 'Hello from mock Anthropic!')

  await wait()
  const requests = getRequests({})
  assert.equal(requests.length, 1)

  const saved = requests[0]
  assert.equal(saved.provider, 'anthropic')
  assert.equal(saved.model, 'claude-sonnet-4-5-20250929')
  assert.equal(saved.status_code, 200)
  assert.equal(saved.output_tokens, 75)
  assert.ok(saved.total_cost! > 0)
  // Anthropic pricing should be used (not default)
  // claude-sonnet-4-5: output=$15/1M, so 75 tokens = $0.001125
  assert.ok(saved.output_cost! < 0.01, `output_cost ${saved.output_cost} should reflect Anthropic pricing`)
})

test('Anthropic proxy: tracks cache read tokens', async () => {
  await request('/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': 'test-key' },
    body: { model: 'claude-sonnet-4-5-20250929', max_tokens: 1024, messages: [{ role: 'user', content: 'hi' }] },
  })

  await wait()
  const saved = getRequests({})[0]
  // Mock returns cache_read_input_tokens: 22000
  assert.equal(saved.cached_tokens, 22000)
  assert.ok(saved.cached_cost! > 0)
})

// --- Dashboard API tests ---

test('GET /api/requests returns logged requests', async () => {
  // Make two proxy requests
  await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-key' },
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'a' }] },
  })
  await request('/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': 'test-key' },
    body: { model: 'claude-sonnet-4-5-20250929', max_tokens: 1024, messages: [{ role: 'user', content: 'b' }] },
  })

  await wait()

  const { status, data } = await request('/api/requests')
  assert.equal(status, 200)
  assert.equal(data.length, 2)
})

test('GET /api/requests supports limit', async () => {
  await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer k' },
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: '1' }] },
  })
  await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer k' },
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: '2' }] },
  })
  await wait()

  const { data } = await request('/api/requests?limit=1')
  assert.equal(data.length, 1)
})

test('GET /api/requests/:id returns specific request', async () => {
  await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer k' },
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
  })
  await wait()

  const all = getRequests({})
  const id = all[0].id
  const { status, data } = await request(`/api/requests/${id}`)
  assert.equal(status, 200)
  assert.equal(data.id, id)
})

test('GET /api/requests/:id returns 404 for unknown id', async () => {
  const { status } = await request('/api/requests/nonexistent')
  assert.equal(status, 404)
})

test('DELETE /api/requests/:id removes a request', async () => {
  await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer k' },
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
  })
  await wait()

  const id = getRequests({})[0].id
  const { status } = await request(`/api/requests/${id}`, { method: 'DELETE' })
  assert.equal(status, 200)
  assert.equal(getRequest(id), null)
})

test('DELETE /api/requests clears all', async () => {
  await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer k' },
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: '1' }] },
  })
  await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer k' },
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: '2' }] },
  })
  await wait()

  const { status } = await request('/api/requests', { method: 'DELETE' })
  assert.equal(status, 200)
  assert.equal(getRequests({}).length, 0)
})

test('GET /api/stats returns aggregated stats', async () => {
  await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer k' },
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: '1' }] },
  })
  await request('/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': 'k' },
    body: { model: 'claude-sonnet-4-5-20250929', max_tokens: 1024, messages: [{ role: 'user', content: '2' }] },
  })
  await wait()

  const { status, data } = await request('/api/stats')
  assert.equal(status, 200)
  assert.equal(data.totalRequests, 2)
  assert.ok(data.totalCost > 0)
  assert.equal(data.byModel.length, 2)
})

// --- Replay tests ---

test('Replay: replays an OpenAI request', async () => {
  await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer k' },
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
  })
  await wait()

  const originalId = getRequests({})[0].id
  const { status, data } = await request(`/api/replay/${originalId}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer replay-key' },
  })

  assert.equal(status, 200)
  assert.ok(data.id)
  assert.ok(data.response)
  assert.ok(data.comparison)
  assert.equal(data.comparison.original.id, originalId)

  await wait()
  const all = getRequests({})
  assert.equal(all.length, 2)
  const replay = all.find(r => r.replay_of === originalId)
  assert.ok(replay, 'replay request should reference original')
})

test('Replay: replays an Anthropic request', async () => {
  await request('/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': 'k' },
    body: { model: 'claude-sonnet-4-5-20250929', max_tokens: 1024, messages: [{ role: 'user', content: 'hi' }] },
  })
  await wait()

  const originalId = getRequests({})[0].id
  const { status, data } = await request(`/api/replay/${originalId}`, {
    method: 'POST',
    headers: { 'x-api-key': 'replay-anthropic-key' },
  })

  assert.equal(status, 200)
  assert.ok(data.response)
  assert.equal(data.response.content[0].text, 'Hello from mock Anthropic!')

  await wait()
  const replay = getRequests({}).find(r => r.replay_of === originalId)
  assert.ok(replay)
  assert.equal(replay!.provider, 'anthropic')
})

test('Replay: returns 404 for unknown request', async () => {
  const { status } = await request('/api/replay/nonexistent', {
    method: 'POST',
    headers: { Authorization: 'Bearer k' },
  })
  assert.equal(status, 404)
})

test('Replay: returns 400 without API key', async () => {
  await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer k' },
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
  })
  await wait()

  const originalId = getRequests({})[0].id
  const { status } = await request(`/api/replay/${originalId}`, { method: 'POST' })
  assert.equal(status, 400)
})

// --- CORS test ---

test('OPTIONS requests return 200 for CORS preflight', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, { method: 'OPTIONS' })
  assert.equal(res.status, 200)
})
