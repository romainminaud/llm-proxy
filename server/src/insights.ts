import type { RequestRecord } from './types.js';

/**
 * Body-derived session insights: where the context tokens actually go and
 * whether the cache prefix is being reused. Computed lazily (bodies are large)
 * on GET /api/sessions/:id?insights=1, from the session's stored requests.
 *
 * Char/4 is the same rough chars≈tokens estimate the frontend uses; these are
 * attribution hints, not billing numbers.
 */
export type SessionInsights = {
  tools_schema_bytes: number | null;
  tools_schema_est_tokens: number | null;
  system_prompt_bytes: number | null;
  system_prompt_est_tokens: number | null;
  cache_control_blocks: number | null;
  // usage.cache_creation TTL mix from the last response that reported it
  ephemeral_5m_tokens: number | null;
  ephemeral_1h_tokens: number | null;
  largest_tool_results: Array<{ tool: string; bytes: number; est_tokens: number }>;
  // Turn pairs where the next request re-read far less than what was just
  // written+read — the cached prefix was likely invalidated between them.
  cache_invalidation_warnings: Array<{ turn: number; wrote: number; next_read: number }>;
};

type Dict = Record<string, unknown>;

const asDict = (v: unknown): Dict | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : null;

const estTokens = (bytes: number) => Math.round(bytes / 4);

function jsonBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function countCacheControl(value: unknown, depth = 0): number {
  if (depth > 6 || value === null || typeof value !== 'object') return 0;
  let count = 0;
  if (Array.isArray(value)) {
    for (const item of value) count += countCacheControl(item, depth + 1);
    return count;
  }
  const dict = value as Dict;
  if ('cache_control' in dict) count += 1;
  // Only recurse into the places cache_control can live, not entire bodies
  for (const key of ['system', 'messages', 'tools', 'content']) {
    if (key in dict) count += countCacheControl(dict[key], depth + 1);
  }
  return count;
}

/** Map tool_use_id -> tool name across all assistant messages in a request body. */
function toolNameById(body: Dict): Map<string, string> {
  const names = new Map<string, string>();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const message of messages) {
    const m = asDict(message);
    if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      const b = asDict(block);
      if (b?.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
        names.set(b.id, b.name);
      }
    }
  }
  return names;
}

function largestToolResults(body: Dict): SessionInsights['largest_tool_results'] {
  const results: Array<{ tool: string; bytes: number }> = [];
  const names = toolNameById(body);
  const messages = Array.isArray(body.messages) ? body.messages : [];

  for (const message of messages) {
    const m = asDict(message);
    if (!m) continue;

    // OpenAI: whole messages with role "tool"
    if (m.role === 'tool') {
      results.push({
        tool: typeof m.name === 'string' ? m.name : 'unknown',
        bytes: jsonBytes(m.content),
      });
      continue;
    }

    // Anthropic: tool_result blocks inside user messages
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        const b = asDict(block);
        if (b?.type !== 'tool_result') continue;
        const id = typeof b.tool_use_id === 'string' ? b.tool_use_id : '';
        results.push({ tool: names.get(id) ?? 'unknown', bytes: jsonBytes(b.content) });
      }
    }
  }

  // Gemini: functionResponse parts inside contents
  const contents = Array.isArray(body.contents) ? body.contents : [];
  for (const content of contents) {
    const parts = asDict(content)?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const fr = asDict(asDict(part)?.functionResponse);
      if (fr) {
        results.push({
          tool: typeof fr.name === 'string' ? fr.name : 'unknown',
          bytes: jsonBytes(fr.response),
        });
      }
    }
  }

  return results
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5)
    .map((r) => ({ ...r, est_tokens: estTokens(r.bytes) }));
}

/**
 * requests must be the session's rows in turn order, with parsed bodies.
 * Context attribution uses the LAST request (it has the fullest history and
 * the current tool roster); cache-invalidation flags scan consecutive pairs.
 */
export function computeSessionInsights(requests: RequestRecord[]): SessionInsights {
  const insights: SessionInsights = {
    tools_schema_bytes: null,
    tools_schema_est_tokens: null,
    system_prompt_bytes: null,
    system_prompt_est_tokens: null,
    cache_control_blocks: null,
    ephemeral_5m_tokens: null,
    ephemeral_1h_tokens: null,
    largest_tool_results: [],
    cache_invalidation_warnings: [],
  };

  const last = requests.length > 0 ? asDict(requests[requests.length - 1].request_body) : null;
  if (last) {
    if ('tools' in last) {
      const bytes = jsonBytes(last.tools);
      insights.tools_schema_bytes = bytes;
      insights.tools_schema_est_tokens = estTokens(bytes);
    }
    const system = last.system ?? last.systemInstruction ?? last.instructions;
    if (system !== undefined) {
      const bytes = jsonBytes(system);
      insights.system_prompt_bytes = bytes;
      insights.system_prompt_est_tokens = estTokens(bytes);
    }
    insights.cache_control_blocks = countCacheControl(last);
    insights.largest_tool_results = largestToolResults(last);
  }

  // TTL mix from the last response that reported cache_creation
  for (let i = requests.length - 1; i >= 0; i--) {
    const usage = asDict(asDict(requests[i].response_body)?.usage);
    const creation = usage && asDict(usage.cache_creation);
    if (creation) {
      const fiveMin = creation.ephemeral_5m_input_tokens;
      const oneHour = creation.ephemeral_1h_input_tokens;
      insights.ephemeral_5m_tokens = typeof fiveMin === 'number' ? fiveMin : null;
      insights.ephemeral_1h_tokens = typeof oneHour === 'number' ? oneHour : null;
      break;
    }
  }

  // A healthy agent loop re-reads (previous read + previous write) next turn.
  // Reading much less means the cached prefix was invalidated — the biggest
  // avoidable latency/cost lever.
  for (let i = 0; i < requests.length - 1; i++) {
    const wrote = requests[i].cache_write_tokens ?? 0;
    const read = requests[i].cached_tokens ?? 0;
    const nextRead = requests[i + 1].cached_tokens ?? 0;
    const expected = read + wrote;
    if (expected >= 1000 && nextRead < expected * 0.5) {
      insights.cache_invalidation_warnings.push({ turn: i + 1, wrote, next_read: nextRead });
    }
  }

  return insights;
}
