import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateCost, MODEL_PRICING } from '../src/pricing.ts'

// OpenAI tests

test('calculateCost without cached pricing', () => {
  const result = calculateCost('gpt-4o-mini', 1_000_000, 2_000_000, 0, 0)
  assert.equal(result.inputCost, 0.15)
  assert.equal(result.cachedCost, 0)
  assert.equal(result.cacheWriteCost, 0)
  assert.equal(result.outputCost, 1.2)
  assert.equal(result.totalCost, 1.35)
})

test('calculateCost with cached pricing (OpenAI style)', () => {
  const result = calculateCost('gpt-5-mini', 2_000_000, 1_000_000, 500_000, 0)
  assert.equal(result.inputCost, 0.5)  // 2M tokens * $0.25/1M
  assert.equal(result.cachedCost, 0.0125)  // 500K tokens * $0.025/1M
  assert.equal(result.cacheWriteCost, 0)
  assert.equal(result.outputCost, 2)  // 1M tokens * $2/1M
  assert.equal(result.totalCost, 2.5125)
})

test('calculateCost strips date suffix for model lookup', () => {
  // gpt-4o-mini-2024-07-18 should fall back to gpt-4o-mini pricing
  const result = calculateCost('gpt-4o-mini-2024-07-18', 1_000_000, 1_000_000, 0, 0)
  assert.equal(result.inputCost, 0.15)
  assert.equal(result.outputCost, 0.6)
})

test('calculateCost uses default pricing for unknown models', () => {
  const result = calculateCost('unknown-model-xyz', 1_000_000, 1_000_000, 0, 0)
  // Default pricing: input: 10.00, output: 30.00 per 1M
  assert.equal(result.inputCost, 10)
  assert.equal(result.outputCost, 30)
})

test('calculateCost handles zero tokens', () => {
  const result = calculateCost('gpt-4o', 0, 0, 0, 0)
  assert.equal(result.inputCost, 0)
  assert.equal(result.cachedCost, 0)
  assert.equal(result.cacheWriteCost, 0)
  assert.equal(result.outputCost, 0)
  assert.equal(result.totalCost, 0)
})

test('calculateCost handles small token counts', () => {
  const result = calculateCost('gpt-4o-mini', 100, 50, 0, 0)
  // 100 tokens at $0.15/1M = $0.000015
  // 50 tokens at $0.60/1M = $0.00003
  assert.ok(result.inputCost > 0)
  assert.ok(result.outputCost > 0)
  assert.ok(result.totalCost < 0.001)
})

test('MODEL_PRICING contains expected OpenAI models', () => {
  assert.ok('gpt-4o' in MODEL_PRICING)
  assert.ok('gpt-4o-mini' in MODEL_PRICING)
  assert.ok('gpt-4-turbo' in MODEL_PRICING)
  assert.ok('o1' in MODEL_PRICING)
  assert.ok('o3-mini' in MODEL_PRICING)
})

test('cached tokens reduce input cost', () => {
  // With gpt-5-mini: input=$0.25/1M, cached=$0.025/1M
  const withoutCache = calculateCost('gpt-5-mini', 1_000_000, 0, 0, 0)
  const withCache = calculateCost('gpt-5-mini', 1_000_000, 0, 500_000, 0)

  // Cached cost is much cheaper than input cost
  assert.ok(withCache.cachedCost > 0)
  assert.ok(withCache.totalCost > withoutCache.totalCost)
})

// Anthropic tests

test('MODEL_PRICING contains expected Anthropic models', () => {
  assert.ok('claude-opus-4-5' in MODEL_PRICING)
  assert.ok('claude-sonnet-4-5' in MODEL_PRICING)
  assert.ok('claude-haiku-4-5' in MODEL_PRICING)
  assert.ok('claude-3-5-sonnet' in MODEL_PRICING)
  assert.ok('claude-3-opus' in MODEL_PRICING)
  assert.ok('claude-3-haiku' in MODEL_PRICING)
})

test('Anthropic model date suffix stripping works', () => {
  // claude-sonnet-4-5-20250929 should fall back to claude-sonnet-4-5
  const result = calculateCost('claude-sonnet-4-5-20250929', 1_000_000, 1_000_000, 0, 0)
  assert.equal(result.inputCost, 3.00)  // $3/1M
  assert.equal(result.outputCost, 15.00)  // $15/1M
})

test('Anthropic cache read cost calculation', () => {
  // claude-sonnet-4-5: input=$3, cached=$0.30, output=$15 per 1M
  const result = calculateCost('claude-sonnet-4-5', 2470, 1675, 22259, 0)

  // input: 2470 * $3/1M = $0.00741
  assert.ok(Math.abs(result.inputCost - 0.00741) < 0.00001)

  // cached: 22259 * $0.30/1M = $0.0066777
  assert.ok(Math.abs(result.cachedCost - 0.0066777) < 0.00001)

  // output: 1675 * $15/1M = $0.025125
  assert.ok(Math.abs(result.outputCost - 0.025125) < 0.00001)

  // cacheWrite: 0
  assert.equal(result.cacheWriteCost, 0)

  // total should be around $0.039
  assert.ok(Math.abs(result.totalCost - 0.0392127) < 0.0001)
})

test('Anthropic cache write cost calculation', () => {
  // claude-sonnet-4-5: input=$3, cacheWrite=$3.75, output=$15 per 1M
  const result = calculateCost('claude-sonnet-4-5', 2339, 1676, 0, 22259)

  // input: 2339 * $3/1M = $0.007017
  assert.ok(Math.abs(result.inputCost - 0.007017) < 0.00001)

  // cached: 0
  assert.equal(result.cachedCost, 0)

  // cacheWrite: 22259 * $3.75/1M = $0.08347125
  assert.ok(Math.abs(result.cacheWriteCost - 0.08347125) < 0.00001)

  // output: 1676 * $15/1M = $0.02514
  assert.ok(Math.abs(result.outputCost - 0.02514) < 0.00001)

  // total should be around $0.1156
  assert.ok(Math.abs(result.totalCost - 0.11562825) < 0.0001)
})

test('Anthropic Opus 4.5 pricing', () => {
  // claude-opus-4-5: input=$5, cached=$0.50, cacheWrite=$6.25, output=$25 per 1M
  const result = calculateCost('claude-opus-4-5', 1_000_000, 1_000_000, 500_000, 200_000)

  assert.equal(result.inputCost, 5.00)
  assert.equal(result.cachedCost, 0.25)  // 500K * $0.50/1M
  assert.equal(result.cacheWriteCost, 1.25)  // 200K * $6.25/1M
  assert.equal(result.outputCost, 25.00)
  assert.equal(result.totalCost, 31.50)
})

test('Anthropic Haiku 4.5 pricing', () => {
  // claude-haiku-4-5: input=$1, cached=$0.10, cacheWrite=$1.25, output=$5 per 1M
  const result = calculateCost('claude-haiku-4-5', 1_000_000, 1_000_000, 0, 0)

  assert.equal(result.inputCost, 1.00)
  assert.equal(result.cachedCost, 0)
  assert.equal(result.cacheWriteCost, 0)
  assert.equal(result.outputCost, 5.00)
  assert.equal(result.totalCost, 6.00)
})

test('Anthropic Claude 3 Opus pricing', () => {
  // claude-3-opus: input=$15, cached=$1.50, cacheWrite=$18.75, output=$75 per 1M
  const result = calculateCost('claude-3-opus-20240229', 1_000_000, 500_000, 0, 0)

  assert.equal(result.inputCost, 15.00)
  assert.equal(result.outputCost, 37.50)  // 500K * $75/1M
  assert.equal(result.totalCost, 52.50)
})

test('Anthropic Claude 3 Haiku pricing', () => {
  // claude-3-haiku: input=$0.25, cached=$0.03, cacheWrite=$0.3125, output=$1.25 per 1M
  const result = calculateCost('claude-3-haiku', 1_000_000, 1_000_000, 1_000_000, 500_000)

  assert.equal(result.inputCost, 0.25)
  assert.equal(result.cachedCost, 0.03)
  assert.equal(result.cacheWriteCost, 0.15625)  // 500K * $0.3125/1M
  assert.equal(result.outputCost, 1.25)
  assert.equal(result.totalCost, 1.68625)
})

test('Unknown model uses default pricing with fallback cache write rate', () => {
  // Default: input=$10, output=$30, no cached rate
  // Cache write should default to input * 1.25 = $12.50
  const result = calculateCost('unknown-model', 1_000_000, 1_000_000, 0, 1_000_000)

  assert.equal(result.inputCost, 10.00)
  assert.equal(result.cachedCost, 0)  // No cached rate defined
  assert.equal(result.cacheWriteCost, 12.50)  // Fallback: $10 * 1.25
  assert.equal(result.outputCost, 30.00)
  assert.equal(result.totalCost, 52.50)
})
