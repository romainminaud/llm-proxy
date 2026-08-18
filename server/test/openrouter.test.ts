import test from 'node:test'
import assert from 'node:assert/strict'
import type { Request } from 'express'
import { calculateCost } from '../src/pricing.ts'
import { providers } from '../src/providers.ts'

test('openrouter provider: OpenAI-compatible wiring', () => {
  const provider = providers.openrouter
  assert.ok(provider)
  assert.equal(provider.routePrefix, '/openrouter')

  // Bare /chat/completions and /v1/chat/completions both normalize to /v1
  assert.equal(provider.normalizePath!('/chat/completions'), '/v1/chat/completions')
  assert.equal(provider.normalizePath!('/v1/chat/completions'), '/v1/chat/completions')

  // Bearer auth in, Bearer auth + attribution headers out
  const req = {
    headers: {
      authorization: 'Bearer sk-or-abc',
      'http-referer': 'https://myapp.dev',
      'x-title': 'My App',
    },
  } as unknown as Request
  assert.equal(provider.extractApiKey(req), 'sk-or-abc')
  const headers = provider.buildHeaders('sk-or-abc', req)
  assert.equal(headers.Authorization, 'Bearer sk-or-abc')
  assert.equal(headers['HTTP-Referer'], 'https://myapp.dev')
  assert.equal(headers['X-Title'], 'My App')

  // include_usage injected for chat completions, never for /v1/responses
  const body = { model: 'anthropic/claude-sonnet-4.5', stream: true }
  const chat = provider.prepareStreamBody!(body, '/v1/chat/completions') as Record<string, unknown>
  assert.deepEqual(chat.stream_options, { include_usage: true })
  assert.equal(provider.prepareStreamBody!(body, '/v1/responses'), body)
})

test('pricing: OpenRouter vendor-prefixed model ids resolve to known pricing', () => {
  // "anthropic/claude-sonnet-4.5" should price like "claude-sonnet-4-5"
  const viaOpenrouter = calculateCost('anthropic/claude-sonnet-4.5', 1_000_000, 0)
  const direct = calculateCost('claude-sonnet-4-5', 1_000_000, 0)
  assert.equal(viaOpenrouter.inputCost, direct.inputCost)
  assert.notEqual(viaOpenrouter.inputCost, calculateCost('unknown-model', 1_000_000, 0).inputCost)

  // Plain vendor prefix without dotted version
  const gpt = calculateCost('openai/gpt-4o', 1_000_000, 0)
  assert.equal(gpt.inputCost, calculateCost('gpt-4o', 1_000_000, 0).inputCost)
})
