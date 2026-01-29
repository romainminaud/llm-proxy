import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SaveRequestInput } from '../src/types.ts'

const tempDir = mkdtempSync(join(tmpdir(), 'llm-proxy-'))
process.env.LLM_PROXY_DATA_DIR = tempDir

const db = await import('../src/db.ts')

const createRequest = (overrides: Partial<SaveRequestInput>): SaveRequestInput => ({
  id: `req-${Math.random().toString(16).slice(2)}`,
  timestamp: new Date().toISOString(),
  method: 'POST',
  path: '/v1/responses',
  provider: 'openai',
  model: 'gpt-4o-mini',
  requestBody: { input: 'hi' },
  responseBody: { output: [] },
  statusCode: 200,
  durationMs: 123,
  inputTokens: 10,
  outputTokens: 5,
  cachedTokens: 2,
  cacheWriteTokens: 0,
  inputCost: 0.001,
  cachedCost: 0.0002,
  cacheWriteCost: 0,
  outputCost: 0.002,
  totalCost: 0.0032,
  ...overrides
})

after(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

test('saveRequest and getRequest round-trip', async () => {
  const request = createRequest({ id: 'req-1' })
  await db.saveRequest(request)

  const loaded = db.getRequest('req-1')
  assert.ok(loaded)
  assert.equal(loaded.id, 'req-1')
  assert.equal(loaded.model, 'gpt-4o-mini')
  assert.equal(loaded.input_tokens, 10)
  assert.equal(loaded.total_cost, 0.0032)
})

test('getRequests supports limit and model filter', async () => {
  db.clearAll()
  await db.saveRequest(createRequest({ id: 'req-a', model: 'gpt-4o-mini' }))
  await db.saveRequest(createRequest({ id: 'req-b', model: 'gpt-4o' }))
  await db.saveRequest(createRequest({ id: 'req-c', model: 'gpt-4o-mini' }))

  const all = db.getRequests({ limit: 10 })
  assert.equal(all.length, 3)

  const filtered = db.getRequests({ model: 'gpt-4o-mini' })
  assert.equal(filtered.length, 2)

  const limited = db.getRequests({ limit: 1 })
  assert.equal(limited.length, 1)
})

test('getStats aggregates totals', async () => {
  db.clearAll()
  await db.saveRequest(createRequest({ id: 'req-10', inputTokens: 100, outputTokens: 50, totalCost: 1 }))
  await db.saveRequest(createRequest({ id: 'req-11', inputTokens: 200, outputTokens: 75, totalCost: 2 }))

  const stats = db.getStats()
  assert.equal(stats.totalRequests, 2)
  assert.equal(stats.totalInputTokens, 300)
  assert.equal(stats.totalOutputTokens, 125)
  assert.equal(stats.totalCost, 3)
  assert.equal(stats.byModel.length, 1)
  assert.equal(stats.byModel[0].count, 2)
})

test('deleteRequest removes specific request', async () => {
  db.clearAll()
  await db.saveRequest(createRequest({ id: 'req-del-1' }))
  await db.saveRequest(createRequest({ id: 'req-del-2' }))

  assert.ok(db.getRequest('req-del-1'))
  db.deleteRequest('req-del-1')
  assert.equal(db.getRequest('req-del-1'), null)
  assert.ok(db.getRequest('req-del-2'))
})

test('clearAll removes all requests', async () => {
  await db.saveRequest(createRequest({ id: 'req-clear-1' }))
  await db.saveRequest(createRequest({ id: 'req-clear-2' }))

  db.clearAll()
  const all = db.getRequests({})
  assert.equal(all.length, 0)
})

test('getRequest returns null for non-existent id', () => {
  const result = db.getRequest('non-existent-id-xyz')
  assert.equal(result, null)
})

test('saveRequest handles replay_of field', async () => {
  db.clearAll()
  const original = createRequest({ id: 'req-orig' })
  await db.saveRequest(original)

  const replay = createRequest({ id: 'req-replay', replayOf: 'req-orig' })
  await db.saveRequest(replay)

  const loaded = db.getRequest('req-replay')
  assert.ok(loaded)
  assert.equal(loaded.replay_of, 'req-orig')
})

test('getStats groups by model correctly', async () => {
  db.clearAll()
  await db.saveRequest(createRequest({ id: 'req-m1', model: 'gpt-4o', totalCost: 1 }))
  await db.saveRequest(createRequest({ id: 'req-m2', model: 'gpt-4o', totalCost: 2 }))
  await db.saveRequest(createRequest({ id: 'req-m3', model: 'o1', totalCost: 5 }))

  const stats = db.getStats()
  assert.equal(stats.byModel.length, 2)

  const gpt4oStats = stats.byModel.find(m => m.model === 'gpt-4o')
  assert.ok(gpt4oStats)
  assert.equal(gpt4oStats.count, 2)
  assert.equal(gpt4oStats.total_cost, 3)
})

test('saveRequest stores provider field', async () => {
  db.clearAll()
  await db.saveRequest(createRequest({ id: 'req-provider', provider: 'anthropic' }))

  const loaded = db.getRequest('req-provider')
  assert.ok(loaded)
  assert.equal(loaded.provider, 'anthropic')
})

test('saveRequest stores cache write fields', async () => {
  db.clearAll()
  await db.saveRequest(createRequest({
    id: 'req-cache-write',
    provider: 'anthropic',
    cacheWriteTokens: 22259,
    cacheWriteCost: 0.083471
  }))

  const loaded = db.getRequest('req-cache-write')
  assert.ok(loaded)
  assert.equal(loaded.cache_write_tokens, 22259)
  assert.equal(loaded.cache_write_cost, 0.083471)
})

test('saveRequest preserves zero values', async () => {
  db.clearAll()
  await db.saveRequest(createRequest({
    id: 'req-zeros',
    cachedTokens: 0,
    cacheWriteTokens: 0,
    cachedCost: 0,
    cacheWriteCost: 0
  }))

  const loaded = db.getRequest('req-zeros')
  assert.ok(loaded)
  assert.equal(loaded.cached_tokens, 0)
  assert.equal(loaded.cache_write_tokens, 0)
  assert.equal(loaded.cached_cost, 0)
  assert.equal(loaded.cache_write_cost, 0)
})
