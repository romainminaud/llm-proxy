import pricingData from './model-pricing.json' with { type: 'json' };

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

// All base pricing lives in model-pricing.json — the single source of truth.
const BASE_MODEL_PRICING: Record<string, PricingEntry> = pricingData.models;

// Fallback pricing for unknown models (from model-pricing.json "default")
const DEFAULT_PRICING: PricingEntry = pricingData.default;

// Active pricing - starts with the JSON values, can be overridden by config
export let MODEL_PRICING: Record<string, PricingEntry> = { ...BASE_MODEL_PRICING };

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
  MODEL_PRICING = { ...BASE_MODEL_PRICING, ...pricing };
}

/**
 * Reset pricing to defaults (useful for testing)
 */
export function resetPricingToDefaults(): void {
  MODEL_PRICING = { ...BASE_MODEL_PRICING };
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

  // OpenRouter format: "vendor/model" with dotted versions
  // (e.g. "anthropic/claude-sonnet-4.5" -> "claude-sonnet-4-5")
  if (model.includes('/')) {
    const withoutVendor = model.slice(model.indexOf('/') + 1);
    const dashed = withoutVendor.replace(/(\d)\.(\d)/g, '$1-$2');
    for (const candidate of [withoutVendor, dashed]) {
      if (candidate !== model) {
        const pricing = getPricing(candidate);
        if (pricing !== DEFAULT_PRICING) return pricing;
      }
    }
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
