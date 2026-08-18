import test from 'node:test'
import assert from 'node:assert/strict'
import { getTokenSplit } from '../src/tokens.ts'

test('anthropic convention: total = input + cacheRead + cacheWrite', () => {
  const split = getTokenSplit(4, 51605, 2128, false)
  assert.equal(split.totalInputTokens, 4 + 51605 + 2128)
  assert.equal(split.nonCachedInputTokens, 4)
  assert.equal(split.cachedInputTokens, 51605)
})

test('anthropic convention: small cache read is not misclassified', () => {
  // The old magnitude heuristic (cacheRead > input) put this in the
  // inclusive branch and undercounted total input as 50000.
  const split = getTokenSplit(50000, 2000, 0, false)
  assert.equal(split.totalInputTokens, 52000)
  assert.equal(split.nonCachedInputTokens, 50000)
  assert.equal(split.cachedInputTokens, 2000)
})

test('inclusive convention (openai/gemini): cached is inside input', () => {
  const split = getTokenSplit(100, 20, 0, true)
  assert.equal(split.totalInputTokens, 100)
  assert.equal(split.nonCachedInputTokens, 80)
  assert.equal(split.cachedInputTokens, 20)
})

test('inclusive convention: non-cached never goes negative', () => {
  const split = getTokenSplit(10, 20, 0, true)
  assert.equal(split.nonCachedInputTokens, 0)
})
