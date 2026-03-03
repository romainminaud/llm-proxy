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

// Structured output response format
export type ResponseFormat = {
  type: 'json_schema'
  json_schema: {
    name: string
    schema: Record<string, unknown>
    strict?: boolean
  }
}

// Gemini thinking budget levels
export type GeminiThinkingLevel = 'none' | 'low' | 'medium' | 'high'

// Per-target settings for comparison
export type TargetSettings = {
  systemPromptOverride?: string   // Overrides global systemPrompt if set
  temperature?: number            // 0.0 to 2.0
  responseFormat?: ResponseFormat // Structured output JSON schema
  thinkingLevel?: GeminiThinkingLevel // Gemini thinking budget (none=0, low=1024, medium=8192, high=24576)
  anthropicThinkingBudget?: number   // Anthropic extended thinking budget_tokens (0 = disabled)
}

// Multi-model comparison types
export type CompareTarget = {
  provider: string
  model: string
  settings?: TargetSettings       // Optional per-target overrides
}

export type CompareResult = {
  target: CompareTarget
  success: boolean
  error?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  inputCost?: number
  cachedCost?: number
  cacheWriteCost?: number
  outputCost?: number
  totalCost?: number
  durationMs?: number
  response?: unknown
}

export type CompareResponse = {
  results: CompareResult[]
}

// Message types for the compare UI
export type CompareMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type CompareRequest = {
  systemPrompt: string
  messages: CompareMessage[]
  targets: CompareTarget[]
}

// Saved comparison type
export type SavedComparison = {
  id: string
  name: string
  systemPrompt: string
  messages: CompareMessage[]
  targets: CompareTarget[]
  maxTokens: number
  createdAt: number
  updatedAt: number
  lastResults?: CompareResult[]
}
