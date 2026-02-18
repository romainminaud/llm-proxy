import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { loadPricingFromConfig, setModelPricing, type PricingEntry } from './pricing.js';
import { logger } from './logger.js';

export type Config = {
  port: number;
  dataDir: string;
  databasePath: string;
  openaiBaseUrl: string;
  anthropicBaseUrl: string;
  geminiBaseUrl: string;
  nodeEnv: 'development' | 'production' | 'test';
  trustProxy: boolean;
  corsOrigin: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  pricing?: Record<string, PricingEntry>;
  pricingOverrides?: Record<string, PricingEntry>;
};

const DEFAULT_CONFIG: Config = {
  port: 8090,
  dataDir: './data',
  databasePath: './data/llm-proxy.db',
  openaiBaseUrl: 'https://api.openai.com',
  anthropicBaseUrl: 'https://api.anthropic.com',
  geminiBaseUrl: 'https://generativelanguage.googleapis.com',
  nodeEnv: 'development',
  trustProxy: false,
  corsOrigin: '*',
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 1000,
};

function validatePort(port: number): void {
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${port}. Must be between 1 and 65535`);
  }
}

function validateUrl(url: string, name: string): void {
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid ${name}: ${url}. Must be a valid URL`);
  }
}

function loadConfigFile(): Partial<Config> {
  const configPaths = [
    resolve(process.cwd(), 'llm-proxy.config.json'),
    resolve(process.cwd(), '.llm-proxy.json'),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        logger.info(`Loaded config from ${configPath}`);
        return JSON.parse(content) as Partial<Config>;
      } catch (e) {
        logger.warn(`Failed to parse config file ${configPath}`, { error: String(e) });
      }
    }
  }

  return {};
}

function getNodeEnv(): 'development' | 'production' | 'test' {
  const env = process.env.NODE_ENV?.toLowerCase();
  if (env === 'production' || env === 'test') {
    return env;
  }
  return 'development';
}

export function loadConfig(): Config {
  const fileConfig = loadConfigFile();

  const port = Number(process.env.PORT) || fileConfig.port || DEFAULT_CONFIG.port;
  const openaiBaseUrl = process.env.OPENAI_API_BASE_URL || fileConfig.openaiBaseUrl || DEFAULT_CONFIG.openaiBaseUrl;
  const anthropicBaseUrl = process.env.ANTHROPIC_API_BASE_URL || fileConfig.anthropicBaseUrl || DEFAULT_CONFIG.anthropicBaseUrl;
  const geminiBaseUrl = process.env.GEMINI_API_BASE_URL || fileConfig.geminiBaseUrl || DEFAULT_CONFIG.geminiBaseUrl;

  // Validate configuration
  validatePort(port);
  validateUrl(openaiBaseUrl, 'OPENAI_API_BASE_URL');
  validateUrl(anthropicBaseUrl, 'ANTHROPIC_API_BASE_URL');
  validateUrl(geminiBaseUrl, 'GEMINI_API_BASE_URL');

  const dataDir = process.env.LLM_PROXY_DATA_DIR || fileConfig.dataDir || DEFAULT_CONFIG.dataDir;

  const config: Config = {
    port,
    dataDir,
    databasePath: process.env.LLM_PROXY_DATABASE_PATH || fileConfig.databasePath || `${dataDir}/llm-proxy.db`,
    openaiBaseUrl,
    anthropicBaseUrl,
    geminiBaseUrl,
    nodeEnv: getNodeEnv(),
    trustProxy: process.env.TRUST_PROXY === 'true' || fileConfig.trustProxy || DEFAULT_CONFIG.trustProxy,
    corsOrigin: process.env.CORS_ORIGIN || fileConfig.corsOrigin || DEFAULT_CONFIG.corsOrigin,
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || fileConfig.rateLimitWindowMs || DEFAULT_CONFIG.rateLimitWindowMs,
    rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || fileConfig.rateLimitMaxRequests || DEFAULT_CONFIG.rateLimitMaxRequests,
    pricing: fileConfig.pricing,
    pricingOverrides: fileConfig.pricingOverrides,
  };

  // Load full pricing config if provided (merges with defaults)
  if (config.pricing && Object.keys(config.pricing).length > 0) {
    loadPricingFromConfig(config.pricing);
    logger.info(`Loaded pricing for ${Object.keys(config.pricing).length} models from config`);
  }

  // Apply individual pricing overrides (for backward compatibility)
  if (config.pricingOverrides && Object.keys(config.pricingOverrides).length > 0) {
    for (const [model, pricing] of Object.entries(config.pricingOverrides)) {
      setModelPricing(model, pricing);
      logger.debug(`Applied pricing override for ${model}`, pricing);
    }
  }

  return config;
}

export const config = loadConfig();
