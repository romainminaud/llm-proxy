import type { RequestRecord } from '../types'

// Tool names called in a request's response, in call order.
// Prefers the extracted tool_names column (populated at ingest/backfill);
// falls back to parsing the stored body for rows saved before extraction
// existed. The fallback covers all three providers, not just OpenAI.
export function getToolNames(request: RequestRecord): string[] {
  if (Array.isArray(request.tool_names)) return request.tool_names
  return extractToolNamesFromBody(request.response_body)
}

export function extractToolNamesFromBody(responseBody: unknown): string[] {
  if (!responseBody || typeof responseBody !== 'object') return []
  const body = responseBody as Record<string, unknown>
  const names: string[] = []

  // OpenAI chat completions: choices[].message.tool_calls[].function.name
  if (Array.isArray(body.choices)) {
    for (const choice of body.choices as Array<{ message?: { tool_calls?: Array<{ function?: { name?: string } }> } }>) {
      for (const call of choice.message?.tool_calls ?? []) {
        if (call.function?.name) names.push(call.function.name)
      }
    }
    return names
  }

  // Anthropic: content[].type === 'tool_use'
  if (Array.isArray(body.content)) {
    for (const block of body.content as Array<{ type?: string; name?: string }>) {
      if (block.type === 'tool_use') names.push(block.name ?? 'unknown')
    }
    return names
  }

  // Gemini: candidates[].content.parts[].functionCall.name
  if (Array.isArray(body.candidates)) {
    for (const candidate of body.candidates as Array<{ content?: { parts?: Array<{ functionCall?: { name?: string } }> } }>) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.functionCall) names.push(part.functionCall.name ?? 'unknown')
      }
    }
    return names
  }

  // OpenAI Responses API: output[].type === 'function_call'
  if (Array.isArray(body.output)) {
    for (const item of body.output as Array<{ type?: string; name?: string }>) {
      if (item.type === 'function_call') names.push(item.name ?? 'unknown')
    }
  }

  return names
}

// name -> count, preserving first-seen order
export function countToolCalls(names: string[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Array.from(counts.entries())
}

export function shortSessionId(sessionId: string): string {
  const [prefix, rest] = sessionId.includes(':')
    ? [sessionId.slice(0, sessionId.indexOf(':')), sessionId.slice(sessionId.indexOf(':') + 1)]
    : ['', sessionId]
  return `${prefix ? `${prefix}:` : ''}${rest.slice(0, 8)}`
}

export function formatRatio(ratio: number | null | undefined): string {
  // Absence rule: dash when unobserved, never a fake 0%
  if (ratio === null || ratio === undefined) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}
