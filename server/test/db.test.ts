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

// --- Sessions ---

const sessionRequest = (overrides: Partial<SaveRequestInput>): SaveRequestInput =>
  createRequest({
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    sessionId: 's:sess-1',
    agentEntrypoint: 'sdk-cli',
    agentVersion: '2.1.153',
    ...overrides,
  })

test('saveRequest round-trips agentic metadata', async () => {
  db.clearAll()
  await db.saveRequest(sessionRequest({
    id: 'req-agent',
    toolsDefinedCount: 37,
    toolCallsCount: 2,
    toolNames: ['Read', 'Bash'],
    reasoningTokens: 250,
    stopReason: 'tool_use',
    messageCount: 3,
    requestBytes: 1000,
    responseBytes: 500,
  }))

  const loaded = db.getRequest('req-agent')
  assert.ok(loaded)
  assert.equal(loaded.session_id, 's:sess-1')
  assert.equal(loaded.agent_entrypoint, 'sdk-cli')
  assert.equal(loaded.tools_defined_count, 37)
  assert.equal(loaded.tool_calls_count, 2)
  assert.deepEqual(loaded.tool_names, ['Read', 'Bash'])
  assert.equal(loaded.reasoning_tokens, 250)
  assert.equal(loaded.stop_reason, 'tool_use')
  assert.equal(loaded.message_count, 3)
})

test('getSessions aggregates per session with cache hit ratio', async () => {
  db.clearAll()
  await db.saveRequest(sessionRequest({
    id: 's1-r1',
    timestamp: '2026-08-17T10:00:00.000Z',
    nonCachedInputTokens: 100,
    cachedInputTokens: 0,
    cacheWriteTokens: 900,
    outputTokens: 50,
    toolCallsCount: 1,
    toolNames: ['Bash'],
    totalCost: 0.01,
    durationMs: 2000,
    stopReason: 'tool_use',
  }))
  await db.saveRequest(sessionRequest({
    id: 's1-r2',
    timestamp: '2026-08-17T10:00:30.000Z',
    nonCachedInputTokens: 100,
    cachedInputTokens: 900,
    cacheWriteTokens: 0,
    outputTokens: 60,
    toolCallsCount: 2,
    toolNames: ['Read', 'Bash'],
    totalCost: 0.02,
    durationMs: 3000,
    stopReason: 'end_turn',
  }))
  await db.saveRequest(createRequest({ id: 'other', sessionId: 's:sess-2' }))
  await db.saveRequest(createRequest({ id: 'no-session' }))

  const sessions = db.getSessions()
  assert.equal(sessions.length, 2)
  assert.equal(db.countSessions(), 2)

  const s1 = sessions.find(s => s.session_id === 's:sess-1')
  assert.ok(s1)
  assert.equal(s1.request_count, 2)
  assert.equal(s1.input_tokens, 200)
  assert.equal(s1.cache_read_tokens, 900)
  assert.equal(s1.cache_write_tokens, 900)
  assert.equal(s1.output_tokens, 110)
  assert.equal(s1.tool_calls, 3)
  assert.equal(s1.api_ms, 5000)
  assert.equal(s1.wall_ms, 30000)
  // 900 read / (200 + 900 + 900)
  assert.ok(Math.abs((s1.cache_hit_ratio ?? 0) - 900 / 2000) < 1e-9)
  assert.equal(s1.last_stop_reason, 'end_turn')
  assert.equal(s1.agent_entrypoint, 'sdk-cli')
})

test('cache hit ratio is null when no tokens observed (absence rule)', async () => {
  db.clearAll()
  await db.saveRequest(createRequest({
    id: 'err-1',
    sessionId: 's:err',
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    error: 'boom',
  }))

  const sessions = db.getSessions()
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].cache_hit_ratio, null)
  assert.equal(sessions[0].error_count, 1)
})

test('getSessionDetail rolls up turn-tagged requests', async () => {
  db.clearAll()
  await db.saveRequest(sessionRequest({
    id: 't-r1',
    timestamp: '2026-08-17T09:00:00.000Z',
    turnId: 'turn-1',
    outputTokens: 10,
    totalCost: 0.01,
    toolCallsCount: 1,
  }))
  await db.saveRequest(sessionRequest({
    id: 't-r2',
    timestamp: '2026-08-17T09:00:05.000Z',
    turnId: 'turn-1',
    outputTokens: 20,
    totalCost: 0.02,
    error: 'boom',
    stopReason: null,
  }))
  await db.saveRequest(sessionRequest({
    id: 't-r3',
    timestamp: '2026-08-17T09:01:00.000Z',
    turnId: 'turn-2',
    outputTokens: 5,
    totalCost: 0.05,
  }))
  // Untagged request: appears in the timeline but in no turn rollup
  await db.saveRequest(sessionRequest({
    id: 't-r4',
    timestamp: '2026-08-17T09:02:00.000Z',
    outputTokens: 1,
  }))

  const detail = db.getSessionDetail('s:sess-1')
  assert.ok(detail)
  assert.equal(detail.requests.length, 4)
  assert.equal(detail.requests[0].turn_id, 'turn-1')
  assert.equal(detail.requests[3].turn_id, null)

  assert.equal(detail.turns.length, 2)
  const [turn1, turn2] = detail.turns
  assert.equal(turn1.turn_id, 'turn-1')
  assert.equal(turn1.request_count, 2)
  assert.equal(turn1.error_count, 1)
  assert.equal(turn1.output_tokens, 30)
  assert.equal(turn1.tool_calls, 1)
  assert.ok(Math.abs(turn1.total_cost - 0.03) < 1e-9)
  assert.equal(turn1.wall_ms, 5000)
  assert.equal(turn2.turn_id, 'turn-2')
  assert.equal(turn2.request_count, 1)

  // Session rollup counts distinct turns (untagged requests don't count)
  assert.equal(detail.session.turn_count, 2)
  assert.equal(db.getSessions()[0].turn_count, 2)

  // Cross-session turns list: newest first, session context attached
  const allTurns = db.getTurns()
  assert.equal(allTurns.length, 2)
  assert.equal(db.countTurns(), 2)
  assert.equal(allTurns[0].turn_id, 'turn-2')
  assert.equal(allTurns[0].session_id, 's:sess-1')
  assert.deepEqual(allTurns[0].models, ['claude-opus-4-7'])
  assert.equal(allTurns[0].agent_entrypoint, 'sdk-cli')
  assert.equal(allTurns[1].turn_id, 'turn-1')
  assert.equal(allTurns[1].request_count, 2)

  // Turn drill-down: rollup + only that turn's requests, seq scoped to the turn
  const turnDetail = db.getTurnDetail('s:sess-1', 'turn-1')
  assert.ok(turnDetail)
  assert.equal(turnDetail.turn.request_count, 2)
  assert.equal(turnDetail.requests.length, 2)
  assert.equal(turnDetail.requests[0].seq, 1)
  assert.equal(turnDetail.requests[0].id, 't-r1')
  assert.equal(turnDetail.tool_usage.Bash, undefined)
  assert.equal(db.getTurnDetail('s:sess-1', 'missing'), null)
})

test('getSessionDetail orders turns and computes context growth', async () => {
  db.clearAll()
  await db.saveRequest(sessionRequest({
    id: 'd-r1',
    timestamp: '2026-08-17T10:00:00.000Z',
    totalInputTokens: 1000,
    toolNames: ['Bash'],
    toolCallsCount: 1,
  }))
  await db.saveRequest(sessionRequest({
    id: 'd-r2',
    timestamp: '2026-08-17T10:00:10.000Z',
    totalInputTokens: 1500,
    toolNames: ['Bash', 'Read'],
    toolCallsCount: 2,
  }))

  const detail = db.getSessionDetail('s:sess-1')
  assert.ok(detail)
  assert.equal(detail.requests.length, 2)
  assert.equal(detail.requests[0].seq, 1)
  assert.equal(detail.requests[0].context_growth, null)
  assert.equal(detail.requests[1].seq, 2)
  assert.equal(detail.requests[1].context_growth, 500)
  assert.deepEqual(detail.tool_usage, { Bash: 2, Read: 1 })
  assert.equal(detail.by_model.length, 1)
  assert.equal(detail.by_model[0].model, 'claude-opus-4-7')

  assert.equal(db.getSessionDetail('s:missing'), null)
})

test('getRequests filters by session and provider, countRequests matches', async () => {
  db.clearAll()
  await db.saveRequest(sessionRequest({ id: 'f-r1' }))
  await db.saveRequest(sessionRequest({ id: 'f-r2' }))
  await db.saveRequest(createRequest({ id: 'f-r3' }))

  assert.equal(db.getRequests({ sessionId: 's:sess-1' }).length, 2)
  assert.equal(db.countRequests({ sessionId: 's:sess-1' }), 2)
  assert.equal(db.getRequests({ provider: 'openai' }).length, 1)
  assert.equal(db.countRequests({ provider: 'openai' }), 1)
})

test('getStats includes cache and reasoning totals', async () => {
  db.clearAll()
  await db.saveRequest(sessionRequest({
    id: 'st-r1',
    nonCachedInputTokens: 100,
    cachedInputTokens: 300,
    cacheWriteTokens: 100,
    reasoningTokens: 40,
  }))

  const stats = db.getStats()
  assert.equal(stats.totalCacheReadTokens, 300)
  assert.equal(stats.totalCacheWriteTokens, 100)
  assert.equal(stats.totalReasoningTokens, 40)
  assert.equal(stats.sessionCount, 1)
  assert.ok(Math.abs((stats.cacheHitRatio ?? 0) - 300 / 500) < 1e-9)
})
