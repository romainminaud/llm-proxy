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
  totalCacheReadTokens?: number
  totalCacheWriteTokens?: number
  totalReasoningTokens?: number
  cacheHitRatio?: number | null
  sessionCount?: number
  byModel: ModelStat[]
}

export type DisplayStats = {
  totalRequests: number
  totalCost: number
  totalInputTokens: number
  totalCachedTokens: number
  totalCacheWriteTokens: number
  totalReasoningTokens: number
  totalOutputTokens: number
  totalDurationMs: number
  totalInputCost: number
  totalCachedCost: number
  totalCacheWriteCost: number
  totalOutputCost: number
  // cacheRead / (nonCached + cacheRead + cacheWrite); null when no tokens observed
  cacheHitRatio: number | null
}

export type RequestRecord = {
  id: string
  timestamp: string | number
  model?: string
  path?: string
  provider?: string
  input_tokens?: number
  total_input_tokens?: number | null
  non_cached_input_tokens?: number | null
  output_tokens?: number
  cached_tokens?: number
  cache_write_tokens?: number | null
  input_cost?: number
  cached_cost?: number
  cache_write_cost?: number | null
  output_cost?: number
  total_cost?: number
  duration_ms?: number
  error?: string
  replay_of?: string
  request_body?: any
  response_body?: any
  // Agentic metadata (null = provider couldn't say)
  session_id?: string | null
  turn_id?: string | null
  agent_entrypoint?: string | null
  agent_version?: string | null
  tools_defined_count?: number | null
  tool_calls_count?: number | null
  tool_names?: string[] | null
  reasoning_tokens?: number | null
  stop_reason?: string | null
  message_count?: number | null
  request_bytes?: number | null
  response_bytes?: number | null
}

// Per-session rollup returned by /api/sessions
export type SessionSummary = {
  session_id: string
  request_count: number
  turn_count: number
  error_count: number
  started_at: string
  ended_at: string
  wall_ms: number
  api_ms: number
  input_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  output_tokens: number
  reasoning_tokens: number
  total_cost: number
  tool_calls: number
  cache_hit_ratio: number | null
  models: string[]
  agent_entrypoint: string | null
  agent_version: string | null
  last_stop_reason: string | null
}

export type SessionRequest = Omit<RequestRecord, 'request_body' | 'response_body'> & {
  seq: number
  context_growth: number | null
}

// Per-turn rollup within a session (grouped by the x-llm-proxy-turn-id header)
export type TurnSummary = {
  turn_id: string
  request_count: number
  error_count: number
  started_at: string
  ended_at: string
  wall_ms: number
  api_ms: number
  input_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  output_tokens: number
  reasoning_tokens: number
  total_cost: number
  tool_calls: number
  last_stop_reason: string | null
}

// One row in the cross-session turns list (/api/turns)
export type TurnListItem = TurnSummary & {
  session_id: string
  models: string[]
  agent_entrypoint: string | null
}

// Drill-down for one turn (/api/sessions/:id/turns/:turnId)
export type TurnDetail = {
  turn: TurnListItem
  requests: SessionRequest[]
  tool_usage: Record<string, number>
}

export type SessionDetail = {
  session: SessionSummary
  requests: SessionRequest[]
  turns: TurnSummary[]
  tool_usage: Record<string, number>
  by_model: Array<{ model: string; count: number; input_tokens: number; output_tokens: number; total_cost: number }>
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
