export type ProviderInfo = {
  name: string
  replayApiKeyHeader: string
  replayApiKeyPlaceholder: string
}

export type ModelStat = {
  model: string
  count: number
}

export type Stats = {
  totalRequests: number
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  byModel: ModelStat[]
}

export type DisplayStats = {
  totalRequests: number
  totalCost: number
  totalInputTokens: number
  totalCachedTokens: number
  totalOutputTokens: number
  totalDurationMs: number
  totalInputCost: number
  totalCachedCost: number
  totalOutputCost: number
}

export type RequestRecord = {
  id: string
  timestamp: string | number
  model?: string
  path?: string
  provider?: string
  input_tokens?: number
  output_tokens?: number
  cached_tokens?: number
  input_cost?: number
  cached_cost?: number
  output_cost?: number
  total_cost?: number
  duration_ms?: number
  error?: string
  replay_of?: string
  request_body?: any
  response_body?: any
}

export type MessageLike = {
  role?: string
  content?: unknown
}

export type NormalizedContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url?: { url?: string } }
  | { type: 'tool_use'; name?: string; input?: unknown }
  | { type: 'tool_result'; content?: unknown }
  | { type: 'unknown'; data: unknown }

export type NormalizedContent = string | NormalizedContentPart[]

export type ReplayComparisonSummary = {
  original: {
    inputTokens: number
    cacheReadTokens: number
    outputTokens: number
    inputCost?: number
    cachedCost?: number
    outputCost?: number
    totalCost?: number
    durationMs: number
  }
  replay: {
    inputTokens: number
    cacheReadTokens: number
    outputTokens: number
    inputCost?: number
    cachedCost?: number
    outputCost?: number
    totalCost?: number
    durationMs: number
  }
  diff: {
    inputTokens: number
    cacheReadTokens: number
    outputTokens: number
    durationMs: number
  }
}
