import test from 'node:test'
import assert from 'node:assert/strict'
import { providers } from '../src/providers.ts'
import { StreamUsageAccumulator } from '../src/streaming.ts'

test('gemini stream: functionCall parts are preserved in the reconstructed body', () => {
  const acc = new StreamUsageAccumulator(providers.gemini)

  acc.push('[')
  acc.push(JSON.stringify({
    candidates: [{ content: { role: 'model', parts: [{ text: 'Let me ' }] } }],
    modelVersion: 'gemini-2.5-pro',
  }))
  acc.push(',')
  acc.push(JSON.stringify({
    candidates: [{ content: { role: 'model', parts: [{ text: 'search.' }] } }],
  }))
  acc.push(',')
  acc.push(JSON.stringify({
    candidates: [{
      content: { role: 'model', parts: [{ functionCall: { name: 'search', args: { q: 'x' } } }] },
      finishReason: 'STOP',
    }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  }))
  acc.push(']')

  const { responseBody, usage, model } = acc.result()
  assert.equal(model, 'gemini-2.5-pro')
  assert.ok(usage)
  assert.ok(responseBody)

  const candidates = responseBody.candidates as Array<{ content: { parts: unknown[] }; finishReason?: string }>
  const parts = candidates[0].content.parts as Array<Record<string, unknown>>
  assert.equal(candidates[0].finishReason, 'STOP')
  // Consecutive text merged into one part; functionCall kept verbatim after it
  assert.equal(parts.length, 2)
  assert.equal(parts[0].text, 'Let me search.')
  assert.deepEqual(parts[1].functionCall, { name: 'search', args: { q: 'x' } })
})

test('anthropic stream: message_delta usage merge keeps nested details', () => {
  const acc = new StreamUsageAccumulator(providers.anthropic)

  const sse = (event: Record<string, unknown>) => `data: ${JSON.stringify(event)}\n`
  acc.push(sse({
    type: 'message_start',
    message: {
      type: 'message', role: 'assistant', model: 'claude-opus-4-7',
      content: [],
      usage: { input_tokens: 1, cache_read_input_tokens: 51605, cache_creation_input_tokens: 2128 },
    },
  }))
  acc.push(sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
  acc.push(sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } }))
  acc.push(sse({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 1060, output_tokens_details: { thinking_tokens: 250 } },
  }))

  const { usage, responseBody } = acc.result()
  assert.ok(usage)
  assert.equal(usage.input_tokens, 1)
  assert.equal(usage.cache_read_input_tokens, 51605)
  assert.equal(usage.output_tokens, 1060)
  assert.deepEqual(usage.output_tokens_details, { thinking_tokens: 250 })
  assert.ok(responseBody)
  assert.equal(responseBody.stop_reason, 'end_turn')
})
