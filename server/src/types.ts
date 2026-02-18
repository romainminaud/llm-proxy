// Provider name - extensible string type with known values for autocomplete
export type Provider = 'openai' | 'anthropic' | (string & {})

export type RequestRecord = {
  id: string
  timestamp: string
  method: string
  path: string
  provider: Provider
  model: string | null
  request_body: unknown
  response_body: unknown | null
  status_code: number | null
  duration_ms: number | null
  input_tokens: number | null
  total_input_tokens?: number | null
  non_cached_input_tokens?: number | null
  cached_input_tokens?: number | null
  output_tokens: number | null
  cached_tokens: number | null        // Cache read tokens
  cache_write_tokens: number | null   // Cache creation tokens (Anthropic)
  input_cost: number | null
  cached_cost: number | null          // Cache read cost
  cache_write_cost: number | null     // Cache creation cost
  output_cost: number | null
  total_cost: number | null
  error: string | null
  replay_of: string | null
}

export type SaveRequestInput = {
  id: string
  timestamp: string
  method: string
  path: string
  provider: Provider
  model: string | null
  requestBody: unknown
  responseBody: unknown | null
  statusCode: number | null
  durationMs: number | null
  inputTokens?: number | null
  totalInputTokens?: number | null
  nonCachedInputTokens?: number | null
  cachedInputTokens?: number | null
  outputTokens?: number | null
  cachedTokens?: number | null        // Cache read tokens
  cacheWriteTokens?: number | null    // Cache creation tokens (Anthropic)
  inputCost: number | null
  cachedCost: number | null          // Cache read cost
  cacheWriteCost: number | null      // Cache creation cost
  outputCost: number | null
  totalCost: number | null
  error?: string | null
  replayOf?: string | null
}

export type ModelStats = {
  model: string
  count: number
  input_tokens: number
  output_tokens: number
  total_cost: number
}

export type Stats = {
  totalRequests: number
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  byModel: ModelStats[]
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
}

// Multi-model comparison types
export type CompareTarget = {
  provider: Provider
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
