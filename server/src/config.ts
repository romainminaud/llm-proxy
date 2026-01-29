import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { loadPricingFromConfig, setModelPricing, type PricingEntry } from './pricing.js';

export type Config = {
  port: number;
  dataDir: string;
  openaiBaseUrl: string;
  anthropicBaseUrl: string;
  pricing?: Record<string, PricingEntry>;  // Full pricing config (replaces defaults)
  pricingOverrides?: Record<string, PricingEntry>;  // Legacy: overrides specific models
};

const DEFAULT_CONFIG: Config = {
  port: 8090,
  dataDir: './data/requests',
  openaiBaseUrl: 'https://api.openai.com',
  anthropicBaseUrl: 'https://api.anthropic.com',
};

function loadConfigFile(): Partial<Config> {
  const configPaths = [
    resolve(process.cwd(), 'llm-proxy.config.json'),
    resolve(process.cwd(), '.llm-proxy.json'),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        console.log(`Loaded config from ${configPath}`);
        return JSON.parse(content) as Partial<Config>;
      } catch (e) {
        console.warn(`Failed to parse config file ${configPath}:`, e);
      }
    }
  }

  return {};
}

export function loadConfig(): Config {
  const fileConfig = loadConfigFile();

  const config: Config = {
    port: Number(process.env.PORT) || fileConfig.port || DEFAULT_CONFIG.port,
    dataDir: process.env.LLM_PROXY_DATA_DIR || fileConfig.dataDir || DEFAULT_CONFIG.dataDir,
    openaiBaseUrl: process.env.OPENAI_API_BASE_URL || fileConfig.openaiBaseUrl || DEFAULT_CONFIG.openaiBaseUrl,
    anthropicBaseUrl: process.env.ANTHROPIC_API_BASE_URL || fileConfig.anthropicBaseUrl || DEFAULT_CONFIG.anthropicBaseUrl,
    pricing: fileConfig.pricing,
    pricingOverrides: fileConfig.pricingOverrides,
  };

  // Load full pricing config if provided (merges with defaults)
  if (config.pricing && Object.keys(config.pricing).length > 0) {
    loadPricingFromConfig(config.pricing);
    console.log(`Loaded pricing for ${Object.keys(config.pricing).length} models from config`);
  }

  // Apply individual pricing overrides (for backward compatibility)
  if (config.pricingOverrides && Object.keys(config.pricingOverrides).length > 0) {
    for (const [model, pricing] of Object.entries(config.pricingOverrides)) {
      setModelPricing(model, pricing);
      console.log(`Applied pricing override for ${model}:`, pricing);
    }
  }

  return config;
}

export const config = loadConfig();
