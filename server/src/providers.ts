import type { Request } from 'express';
import { config } from './config.js';

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UsagePayload = any;

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  buildHeaders(apiKey: string): Record<string, string>;
  extractApiKey(req: Request): string | undefined;
  extractTokenUsage(usage: UsagePayload): TokenUsage;
  parseErrorMessage(data: unknown): string;
  routePrefix: string;
  stripPrefix?: string;
  // Frontend replay configuration
  replayApiKeyHeader: string;
  replayApiKeyPlaceholder: string;
}

// Public provider info exposed to frontend
export type ProviderInfo = {
  name: string;
  replayApiKeyHeader: string;
  replayApiKeyPlaceholder: string;
};

const openai: ProviderConfig = {
  name: 'openai',
  baseUrl: config.openaiBaseUrl,
  buildHeaders: (apiKey) => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  }),
  extractApiKey: (req) => req.headers.authorization?.replace('Bearer ', ''),
  extractTokenUsage: (usage) => ({
    inputTokens: usage?.prompt_tokens || usage?.input_tokens || 0,
    outputTokens: usage?.completion_tokens || usage?.output_tokens || 0,
    cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens || 0,
    cacheWriteTokens: 0,
  }),
  parseErrorMessage: (data: unknown) =>
    (data as { error?: { message?: string } })?.error?.message || 'OpenAI API error',
  routePrefix: '/v1',
  replayApiKeyHeader: 'x-openai-api-key',
  replayApiKeyPlaceholder: 'sk-...',
};

const anthropic: ProviderConfig = {
  name: 'anthropic',
  baseUrl: config.anthropicBaseUrl,
  buildHeaders: (apiKey) => ({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'structured-outputs-2025-11-13',
  }),
  extractApiKey: (req) => req.headers['x-api-key'] as string | undefined,
  extractTokenUsage: (usage) => ({
    inputTokens: usage?.input_tokens || 0,
    outputTokens: usage?.output_tokens || 0,
    cacheReadTokens: usage?.cache_read_input_tokens || 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens || 0,
  }),
  parseErrorMessage: (data: unknown) =>
    (data as { error?: { message?: string } })?.error?.message || 'Anthropic API error',
  routePrefix: '/anthropic',
  stripPrefix: '\\/anthropic',
  replayApiKeyHeader: 'x-api-key',
  replayApiKeyPlaceholder: 'sk-ant-...',
};

const gemini: ProviderConfig = {
  name: 'gemini',
  baseUrl: config.geminiBaseUrl,
  buildHeaders: (apiKey) => ({
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  }),
  extractApiKey: (req) => req.headers['x-goog-api-key'] as string | undefined,
  extractTokenUsage: (usage) => ({
    inputTokens: usage?.promptTokenCount || 0,
    outputTokens: usage?.candidatesTokenCount || 0,
    cacheReadTokens: usage?.cachedContentTokenCount || 0,
    cacheWriteTokens: 0,
  }),
  parseErrorMessage: (data: unknown) =>
    (data as { error?: { message?: string } })?.error?.message || 'Gemini API error',
  routePrefix: '/gemini',
  stripPrefix: '\\/gemini',
  replayApiKeyHeader: 'x-goog-api-key',
  replayApiKeyPlaceholder: 'AIza...',
};

export const providers: Record<string, ProviderConfig> = { openai, anthropic, gemini };

export function getProvider(name: string): ProviderConfig {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown provider: ${name}`);
  return provider;
}

export function getProvidersInfo(): Record<string, ProviderInfo> {
  const info: Record<string, ProviderInfo> = {};
  for (const [key, provider] of Object.entries(providers)) {
    info[key] = {
      name: provider.name,
      replayApiKeyHeader: provider.replayApiKeyHeader,
      replayApiKeyPlaceholder: provider.replayApiKeyPlaceholder,
    };
  }
  return info;
}

export async function forward(
  provider: ProviderConfig,
  method: string,
  path: string,
  body: unknown,
  apiKey: string
): Promise<unknown> {
  const url = `${provider.baseUrl}${path}`;

  const options: RequestInit = {
    method,
    headers: provider.buildHeaders(apiKey),
  };

  if (method !== 'GET' && body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(provider.parseErrorMessage(data)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return data;
}
