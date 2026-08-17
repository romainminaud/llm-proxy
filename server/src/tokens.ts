/**
 * Split input tokens into total, non-cached, and cached components.
 *
 * Providers report cache tokens with two conventions, and the caller knows
 * which one applies (ProviderConfig.inputTokensIncludeCache):
 * - OpenAI/Gemini: prompt_tokens/promptTokenCount already INCLUDE cached tokens.
 * - Anthropic: input_tokens EXCLUDES cache_read_input_tokens and
 *   cache_creation_input_tokens, so the true context size is the sum of all three.
 */
export function getTokenSplit(
  inputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  inputTokensIncludeCache: boolean
) {
  if (!inputTokensIncludeCache) {
    return {
      totalInputTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
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
