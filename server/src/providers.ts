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
  buildHeaders(apiKey: string, req?: Request): Record<string, string>;
  extractApiKey(req: Request): string | undefined;
  extractTokenUsage(usage: UsagePayload): TokenUsage;
  // Whether the provider's reported input tokens already include cache reads
  // (OpenAI prompt_tokens, Gemini promptTokenCount) or exclude cache reads and
  // writes entirely (Anthropic input_tokens). Drives getTokenSplit().
  inputTokensIncludeCache: boolean;
  parseErrorMessage(data: unknown): string;
  routePrefix: string;
  stripPrefix?: string;
  // Optional: normalize the upstream path after stripping the route prefix
  // (e.g. ensure Anthropic's /v1 prefix when clients send bare /messages).
  normalizePath?(path: string): string;
  // Optional: adjust the request body before forwarding a streaming request
  // (e.g. ask OpenAI to include usage in the stream). Returns the body to send.
  prepareStreamBody?(body: unknown, path: string): unknown;
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
    // Chat Completions nests cache reads under prompt_tokens_details,
    // the Responses API under input_tokens_details.
    cacheReadTokens:
      usage?.prompt_tokens_details?.cached_tokens ||
      usage?.input_tokens_details?.cached_tokens ||
      0,
    cacheWriteTokens: 0,
  }),
  parseErrorMessage: (data: unknown) =>
    (data as { error?: { message?: string } })?.error?.message || 'OpenAI API error',
  // Chat Completions only reports usage in a stream when
  // stream_options.include_usage is set. The Responses API (/v1/responses)
  // rejects that parameter — and doesn't need it, its final
  // response.completed event always carries usage.
  prepareStreamBody: (body, path) => {
    if (!body || typeof body !== 'object') return body;
    if (!path.includes('/chat/completions')) return body;
    const b = body as Record<string, unknown>;
    const existing = (b.stream_options as Record<string, unknown> | undefined) ?? {};
    return { ...b, stream_options: { ...existing, include_usage: true } };
  },
  inputTokensIncludeCache: true,
  routePrefix: '/v1',
  replayApiKeyHeader: 'x-openai-api-key',
  replayApiKeyPlaceholder: 'sk-...',
};

const anthropic: ProviderConfig = {
  name: 'anthropic',
  baseUrl: config.anthropicBaseUrl,
  buildHeaders: (apiKey, req) => {
    // Merge the proxy's required beta flags with any the client sent, so beta
    // features the client opted into (e.g. context-management) keep their
    // enabling header instead of being silently dropped.
    const clientBeta = req?.headers['anthropic-beta'];
    const betaValues = new Set<string>(['structured-outputs-2025-11-13']);
    for (const raw of Array.isArray(clientBeta) ? clientBeta : [clientBeta]) {
      if (typeof raw === 'string') {
        for (const token of raw.split(',')) {
          const t = token.trim();
          if (t) betaValues.add(t);
        }
      }
    }
    const clientVersion = req?.headers['anthropic-version'];
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': (typeof clientVersion === 'string' && clientVersion) || '2023-06-01',
      'anthropic-beta': Array.from(betaValues).join(','),
    };
  },
  extractApiKey: (req) => req.headers['x-api-key'] as string | undefined,
  extractTokenUsage: (usage) => ({
    inputTokens: usage?.input_tokens || 0,
    outputTokens: usage?.output_tokens || 0,
    cacheReadTokens: usage?.cache_read_input_tokens || 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens || 0,
  }),
  parseErrorMessage: (data: unknown) =>
    (data as { error?: { message?: string } })?.error?.message || 'Anthropic API error',
  inputTokensIncludeCache: false,
  routePrefix: '/anthropic',
  stripPrefix: '\\/anthropic',
  // All Anthropic endpoints live under /v1; clients pointed at .../anthropic
  // send bare /messages, which would otherwise 404 upstream.
  normalizePath: (path) => (path.startsWith('/v1/') ? path : `/v1${path}`),
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
  inputTokensIncludeCache: true,
  routePrefix: '/gemini',
  stripPrefix: '\\/gemini',
  replayApiKeyHeader: 'x-goog-api-key',
  replayApiKeyPlaceholder: 'AIza...',
};

// OpenRouter speaks the OpenAI wire format (chat completions + usage shape),
// so everything downstream (streaming accumulator, token extraction,
// agent-meta) reuses the OpenAI code paths via the same conventions.
const openrouter: ProviderConfig = {
  name: 'openrouter',
  baseUrl: config.openrouterBaseUrl,
  buildHeaders: (apiKey, req) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
    // OpenRouter's optional app-attribution headers: forward them when the
    // client sends them (upstream headers are otherwise rebuilt from scratch).
    const referer = req?.headers['http-referer'] ?? req?.headers.referer;
    if (typeof referer === 'string') headers['HTTP-Referer'] = referer;
    const title = req?.headers['x-title'];
    if (typeof title === 'string') headers['X-Title'] = title;
    return headers;
  },
  extractApiKey: (req) => req.headers.authorization?.replace('Bearer ', ''),
  extractTokenUsage: openai.extractTokenUsage,
  parseErrorMessage: (data: unknown) =>
    (data as { error?: { message?: string } })?.error?.message || 'OpenRouter API error',
  prepareStreamBody: openai.prepareStreamBody,
  inputTokensIncludeCache: true,
  routePrefix: '/openrouter',
  stripPrefix: '\\/openrouter',
  // Client base URLs with or without /v1 both work (endpoints live under /v1)
  normalizePath: (path) => (path.startsWith('/v1/') ? path : `/v1${path}`),
  replayApiKeyHeader: 'x-openrouter-api-key',
  replayApiKeyPlaceholder: 'sk-or-...',
};

export const providers: Record<string, ProviderConfig> = { openai, anthropic, gemini, openrouter };

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
  apiKey: string,
  req?: Request
): Promise<unknown> {
  // Normalize here as well as in the proxy handler: replay/compare call this
  // directly, and older stored records may have un-normalized paths.
  const url = `${provider.baseUrl}${provider.normalizePath ? provider.normalizePath(path) : path}`;

  const options: RequestInit = {
    method,
    headers: provider.buildHeaders(apiKey, req),
  };

  if (method !== 'GET' && body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const raw = await response.text().catch(() => '');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: { message: raw || `HTTP ${response.status}` } };
  }

  if (!response.ok) {
    const error = new Error(provider.parseErrorMessage(data)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return data;
}

/**
 * Forward a request that should be streamed back to the client.
 * Returns the raw upstream Response so the caller can pipe the body through
 * while tee-ing it for usage extraction.
 */
export async function forwardStream(
  provider: ProviderConfig,
  method: string,
  path: string,
  body: unknown,
  apiKey: string,
  req?: Request
): Promise<Response> {
  const url = `${provider.baseUrl}${provider.normalizePath ? provider.normalizePath(path) : path}`;

  const options: RequestInit = {
    method,
    headers: provider.buildHeaders(apiKey, req),
  };

  if (method !== 'GET' && body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    // Error responses are JSON even when streaming was requested. Read the
    // body once as text — a second read (.json() then .text()) throws
    // "Body is unusable" and masks the real upstream error.
    const raw = await response.text().catch(() => '');
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { error: { message: raw || `HTTP ${response.status}` } };
    }
    const error = new Error(provider.parseErrorMessage(data)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return response;
}
