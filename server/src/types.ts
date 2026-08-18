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
  // Agentic metadata (null = provider couldn't say, never coerced to 0)
  session_id?: string | null          // "s:<id>" explicit, "h:<hash>" heuristic
  turn_id?: string | null             // verbatim x-llm-proxy-turn-id header
  turn_prompt?: string | null         // snippet of the last genuine user message
  agent_entrypoint?: string | null    // e.g. "sdk-cli" (Claude Code)
  agent_version?: string | null
  tools_defined_count?: number | null
  tool_calls_count?: number | null
  tool_names?: string[] | null        // verbatim wire names
  reasoning_tokens?: number | null
  stop_reason?: string | null         // verbatim per provider
  message_count?: number | null
  request_bytes?: number | null
  response_bytes?: number | null
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
  // Agentic metadata
  sessionId?: string | null
  turnId?: string | null
  turnPrompt?: string | null
  agentEntrypoint?: string | null
  agentVersion?: string | null
  toolsDefinedCount?: number | null
  toolCallsCount?: number | null
  toolNames?: string[] | null
  reasoningTokens?: number | null
  stopReason?: string | null
  messageCount?: number | null
  requestBytes?: number | null
  responseBytes?: number | null
}

export type ModelStats = {
  model: string
  count: number
  input_tokens: number
  output_tokens: number
  total_cost: number
}

// Per-session rollup. Token classes follow softr-as-code's TokenTotals
// vocabulary: input (non-cached), cacheRead, cacheWrite, output, reasoning.
export type SessionSummary = {
  session_id: string
  request_count: number
  turn_count: number     // distinct turn_ids; 0 when nothing is turn-tagged
  error_count: number
  started_at: string
  ended_at: string
  wall_ms: number       // ended_at - started_at (includes tool execution + user time)
  api_ms: number        // sum of per-request durations (time in model)
  input_tokens: number  // non-cached input
  cache_read_tokens: number
  cache_write_tokens: number
  output_tokens: number
  reasoning_tokens: number
  total_cost: number
  tool_calls: number
  // cacheRead / (input + cacheRead + cacheWrite); null when no tokens observed
  cache_hit_ratio: number | null
  models: string[]
  agent_entrypoint: string | null
  agent_version: string | null
  last_stop_reason: string | null
}

// One request inside a session timeline — body columns excluded (fetch via /api/requests/:id)
export type SessionRequest = Omit<RequestRecord, 'request_body' | 'response_body'> & {
  // Ordinal of the request within the session (1-based); not a turn — see turn_id
  seq: number
  // total_input_tokens delta vs the previous request in the session; null for the first
  context_growth: number | null
}

// Cost/call split by model within one turn (e.g. agent model vs title-gen model)
export type TurnModelStat = {
  model: string
  count: number
  total_cost: number
}

// Per-turn rollup inside one session, grouped by the client-supplied
// x-llm-proxy-turn-id header. Requests without a turn_id are not rolled up.
export type TurnSummary = {
  turn_id: string
  // 1-based ordinal within the session, by first-request time
  turn_number: number
  // Prompt that started the turn: the first request's last genuine user message
  turn_prompt: string | null
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
  by_model: TurnModelStat[]   // ordered by cost, highest first
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
  turns: TurnSummary[]                // ordered by first request; empty if nothing is turn-tagged
  tool_usage: Record<string, number>  // tool name -> call count across the session
  by_model: ModelStats[]
}

export type Stats = {
  totalRequests: number
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalReasoningTokens: number
  cacheHitRatio: number | null
  sessionCount: number
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
  anthropicThinkingBudget?: number   // Anthropic extended thinking budget_tokens (0 = disabled)
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
