/**
 * Split input tokens into total, non-cached, and cached components.
 * Handles both OpenAI and Anthropic token reporting conventions.
 */
export function getTokenSplit(inputTokens: number, cacheReadTokens: number) {
  // Anthropic reports cache_read_input_tokens separately from input_tokens
  // so total = input + cache_read. OpenAI includes cached in prompt_tokens.
  if (cacheReadTokens > inputTokens) {
    return {
      totalInputTokens: inputTokens + cacheReadTokens,
      nonCachedInputTokens: inputTokens,
      cachedInputTokens: cacheReadTokens,
    };
  }

  return {
    totalInputTokens: inputTokens,
    nonCachedInputTokens: Math.max(0, inputTokens - cacheReadTokens),
    cachedInputTokens: cacheReadTokens,
  };
}
