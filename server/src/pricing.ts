export type PricingEntry = {
  input: number
  output: number
  cached?: number
  cacheWrite?: number  // For Anthropic cache creation (defaults to input * 1.25)
}

export type CostInfo = {
  inputCost: number
  cachedCost: number       // Cache read cost
  cacheWriteCost: number   // Cache creation cost (Anthropic)
  outputCost: number
  totalCost: number
}

// Default pricing per 1M tokens (as of 2025)
// Prices in USD - these are used as fallback when not configured
export const DEFAULT_MODEL_PRICING: Record<string, PricingEntry> = {
  // GPT-4.1 models
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-2025-04-14': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-mini-2025-04-14': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'gpt-4.1-nano-2025-04-14': { input: 0.10, output: 0.40 },

  // GPT-4o models
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-2024-11-20': { input: 2.50, output: 10.00 },
  'gpt-4o-2024-08-06': { input: 2.50, output: 10.00 },
  'gpt-4o-2024-05-13': { input: 5.00, output: 15.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.60 },

  // GPT-4 Turbo
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4-turbo-2024-04-09': { input: 10.00, output: 30.00 },
  'gpt-4-turbo-preview': { input: 10.00, output: 30.00 },

  // GPT-4
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-4-0613': { input: 30.00, output: 60.00 },
  'gpt-4-32k': { input: 60.00, output: 120.00 },

  // GPT-3.5 Turbo
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'gpt-3.5-turbo-0125': { input: 0.50, output: 1.50 },
  'gpt-3.5-turbo-1106': { input: 1.00, output: 2.00 },
  'gpt-3.5-turbo-instruct': { input: 1.50, output: 2.00 },

  // o1 models
  'o1': { input: 15.00, output: 60.00 },
  'o1-2024-12-17': { input: 15.00, output: 60.00 },
  'o1-preview': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'o1-mini-2024-09-12': { input: 3.00, output: 12.00 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'o3-mini-2025-01-31': { input: 1.10, output: 4.40 },

  // GPT-5 models
  'gpt-5.2': { input: 1.75, cached: 0.175, output: 14.00 },
  'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2.00 },

  // Embeddings
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  'text-embedding-ada-002': { input: 0.10, output: 0 },

  // Gemini models
  'gemini-3-pro-preview': { input: 2.00, cached: 0.50, output: 12.00 },
  'gemini-3-flash-preview': { input: 0.50, cached: 0.125, output: 3.00 },
  'gemini-2.5-pro': { input: 1.25, cached: 0.3125, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, cached: 0.0375, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, cached: 0.025, output: 0.40 },
  'gemini-2.0-flash-lite': { input: 0.075, cached: 0.01875, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, cached: 0.3125, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, cached: 0.01875, output: 0.30 },

  // Anthropic Claude 4 models (base names for date-suffix fallback)
  'claude-opus-4-6': { input: 5.00, cached: 0.50, cacheWrite: 6.25, output: 25.00 },
  'claude-sonnet-4-6': { input: 3.00, cached: 0.30, cacheWrite: 3.75, output: 15.00 },
  'claude-opus-4-5': { input: 5.00, cached: 0.50, cacheWrite: 6.25, output: 25.00 },
  'claude-sonnet-4-5': { input: 3.00, cached: 0.30, cacheWrite: 3.75, output: 15.00 },
  'claude-sonnet-4': { input: 3.00, cached: 0.30, cacheWrite: 3.75, output: 15.00 },
  'claude-haiku-4-5': { input: 1.00, cached: 0.10, cacheWrite: 1.25, output: 5.00 },

  // Anthropic Claude 3.x models (base names for date-suffix fallback)
  'claude-3-7-sonnet': { input: 3.00, cached: 0.30, cacheWrite: 3.75, output: 15.00 },
  'claude-3-5-sonnet': { input: 3.00, cached: 0.30, cacheWrite: 3.75, output: 15.00 },
  'claude-3-5-haiku': { input: 1.00, cached: 0.10, cacheWrite: 1.25, output: 5.00 },
  'claude-3-opus': { input: 15.00, cached: 1.50, cacheWrite: 18.75, output: 75.00 },
  'claude-3-sonnet': { input: 3.00, cached: 0.30, cacheWrite: 3.75, output: 15.00 },
  'claude-3-haiku': { input: 0.25, cached: 0.03, cacheWrite: 0.3125, output: 1.25 },
};

// Default pricing for unknown models
const DEFAULT_PRICING: PricingEntry = { input: 10.00, output: 30.00 };

// Active pricing - starts with defaults, can be overridden by config
export let MODEL_PRICING: Record<string, PricingEntry> = { ...DEFAULT_MODEL_PRICING };

/**
 * Set pricing for a specific model (used by config loading)
 */
export function setModelPricing(model: string, pricing: PricingEntry): void {
  MODEL_PRICING[model] = pricing;
}

/**
 * Replace all model pricing with new values (used by config loading)
 * Merges with defaults so unconfigured models still have fallback pricing
 */
export function loadPricingFromConfig(pricing: Record<string, PricingEntry>): void {
  MODEL_PRICING = { ...DEFAULT_MODEL_PRICING, ...pricing };
}

/**
 * Reset pricing to defaults (useful for testing)
 */
export function resetPricingToDefaults(): void {
  MODEL_PRICING = { ...DEFAULT_MODEL_PRICING };
}

/**
 * Get available models grouped by provider, derived from pricing data
 * Filters out dated versions and embeddings, keeping only base model names
 */
export function getAvailableModelsByProvider(): Record<string, string[]> {
  const openaiModels: string[] = [];
  const anthropicModels: string[] = [];
  const geminiModels: string[] = [];

  for (const model of Object.keys(MODEL_PRICING)) {
    // Skip dated versions (keep only base model names)
    if (/-\d{4}-\d{2}-\d{2}$/.test(model) || /-\d{8}$/.test(model)) {
      continue;
    }
    // Skip embeddings
    if (model.includes('embedding')) {
      continue;
    }

    if (model.startsWith('claude-')) {
      anthropicModels.push(model);
    } else if (model.startsWith('gemini-')) {
      geminiModels.push(model);
    } else {
      // OpenAI models (gpt-*, o1*, o3*, etc.)
      openaiModels.push(model);
    }
  }

  return {
    openai: openaiModels,
    anthropic: anthropicModels,
    gemini: geminiModels,
  };
}

/**
 * Get pricing for a model, with fallback to base model name (strips date suffix)
 * Supports both formats:
 * - OpenAI style: "gpt-4.1-mini-2025-04-14" -> "gpt-4.1-mini"
 * - Anthropic style: "claude-sonnet-4-5-20250929" -> "claude-sonnet-4-5"
 */
function getPricing(model: string): PricingEntry {
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  // Try stripping date suffix - OpenAI format (e.g., -2025-04-14)
  let baseModel = model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  if (MODEL_PRICING[baseModel]) {
    return MODEL_PRICING[baseModel];
  }

  // Try stripping date suffix - Anthropic format (e.g., -20250929)
  baseModel = model.replace(/-\d{8}$/, '');
  if (MODEL_PRICING[baseModel]) {
    return MODEL_PRICING[baseModel];
  }

  return DEFAULT_PRICING;
}

/**
 * Calculate cost for a request based on token usage
 * @param {string} model - The model name
 * @param {number} inputTokens - Number of input/prompt tokens (non-cached)
 * @param {number} outputTokens - Number of output/completion tokens
 * @param {number} cacheReadTokens - Number of cached input tokens read (optional)
 * @param {number} cacheWriteTokens - Number of tokens written to cache (Anthropic cache_creation_input_tokens)
 * @returns {CostInfo}
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): CostInfo {
  const pricing = getPricing(model);

  // Input cost for non-cached tokens
  const inputCost = (inputTokens / 1_000_000) * pricing.input;

  // Cache read cost (discounted rate)
  let cachedCost = 0;
  if (pricing.cached && cacheReadTokens > 0) {
    cachedCost = (cacheReadTokens / 1_000_000) * pricing.cached;
  }

  // Cache write cost (Anthropic charges 1.25x input price for cache creation)
  let cacheWriteCost = 0;
  if (cacheWriteTokens > 0) {
    const cacheWritePrice = pricing.cacheWrite ?? pricing.input * 1.25;
    cacheWriteCost = (cacheWriteTokens / 1_000_000) * cacheWritePrice;
  }

  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const totalCost = inputCost + cachedCost + cacheWriteCost + outputCost;

  const result = {
    inputCost: Math.round(inputCost * 1_000_000_000) / 1_000_000_000,
    cachedCost: Math.round(cachedCost * 1_000_000_000) / 1_000_000_000,
    cacheWriteCost: Math.round(cacheWriteCost * 1_000_000_000) / 1_000_000_000,
    outputCost: Math.round(outputCost * 1_000_000_000) / 1_000_000_000,
    totalCost: Math.round(totalCost * 1_000_000_000) / 1_000_000_000,
  };

  return result;
}
