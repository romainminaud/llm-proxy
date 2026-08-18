import { createHash } from 'crypto';

/**
 * Agentic metadata extracted from stored request/response bodies.
 *
 * Absence rule (borrowed from softr-as-code's agent-metrics): a field the
 * provider could not report is null, never coerced to 0 or ''. This lets
 * consumers distinguish "reported zero" from "couldn't say".
 *
 * stop_reason and tool names pass through verbatim — provider vocabularies
 * (end_turn/tool_use vs stop/tool_calls vs STOP) are deliberately not
 * normalized so records stay greppable against provider docs.
 */
export type AgentMeta = {
  /** "s:<id>" when the client sent an explicit session id, "h:<hash16>" for the heuristic fallback, null when neither applies. */
  sessionId: string | null;
  /** Verbatim x-llm-proxy-turn-id header value; null when the client didn't tag the request. */
  turnId: string | null;
  /** Snippet of the last genuine user message in the request — the prompt that started the current turn. */
  turnPrompt: string | null;
  /** cc_entrypoint from the Claude Code billing header block (e.g. "sdk-cli"). */
  agentEntrypoint: string | null;
  /** cc_version from the Claude Code billing header block. */
  agentVersion: string | null;
  toolsDefinedCount: number | null;
  toolCallsCount: number | null;
  toolNames: string[] | null;
  reasoningTokens: number | null;
  stopReason: string | null;
  messageCount: number | null;
  requestBytes: number | null;
  responseBytes: number | null;
};

/**
 * Vendor-agnostic overrides passed as proxy-level headers. The proxy rebuilds
 * upstream headers from scratch (ProviderConfig.buildHeaders), so these are
 * never forwarded to the provider — any client on any vendor can tag its
 * traffic without the upstream API ever seeing the header.
 *
 *   x-llm-proxy-session-id: <id>            → session_id "s:<id>" (highest priority)
 *   x-llm-proxy-turn-id: <id>               → turn_id, groups requests within a session
 *   x-llm-proxy-agent: <name>[/<version>]   → agent_entrypoint / agent_version
 */
export type AgentMetaOverrides = {
  sessionId: string | null;
  turnId: string | null;
  agentEntrypoint: string | null;
  agentVersion: string | null;
};

export const SESSION_ID_HEADER = 'x-llm-proxy-session-id';
export const TURN_ID_HEADER = 'x-llm-proxy-turn-id';
export const AGENT_HEADER = 'x-llm-proxy-agent';

function headerValue(headers: Record<string, unknown>, name: string): string | null {
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 120);
  return trimmed.length > 0 ? trimmed : null;
}

export function overridesFromHeaders(headers: Record<string, unknown>): AgentMetaOverrides {
  const sessionId = headerValue(headers, SESSION_ID_HEADER);
  const turnId = headerValue(headers, TURN_ID_HEADER);
  const agent = headerValue(headers, AGENT_HEADER);

  let entrypoint: string | null = null;
  let version: string | null = null;
  if (agent) {
    const slash = agent.indexOf('/');
    entrypoint = slash === -1 ? agent : agent.slice(0, slash) || null;
    version = slash === -1 ? null : agent.slice(slash + 1) || null;
  }

  return {
    sessionId: sessionId ? `s:${sessionId}` : null,
    turnId,
    agentEntrypoint: entrypoint,
    agentVersion: version,
  };
}

type Dict = Record<string, unknown>;

function asDict(v: unknown): Dict | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : null;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Flatten message content (a string, or an array of text-bearing parts) into plain text. */
function contentToText(content: unknown): string {
  const s = asString(content);
  if (s !== null) return s;
  const arr = asArray(content);
  if (!arr) return '';
  return arr
    .map((part) => asString(asDict(part)?.text) ?? '')
    .filter(Boolean)
    .join('\n');
}

function systemText(providerName: string, body: Dict): string {
  if (providerName === 'anthropic') {
    return contentToText(body.system);
  }
  if (providerName === 'gemini') {
    const instruction = asDict(body.systemInstruction) ?? asDict(body.system_instruction);
    const parts = instruction && asArray(instruction.parts);
    if (!parts) return '';
    return parts.map((p) => asString(asDict(p)?.text) ?? '').filter(Boolean).join('\n');
  }
  // OpenAI: system/developer message in messages[], or top-level instructions (Responses API)
  const messages = asArray(body.messages) ?? asArray(body.input);
  const system = messages?.find((m) => {
    const role = asString(asDict(m)?.role);
    return role === 'system' || role === 'developer';
  });
  if (system) return contentToText(asDict(system)?.content);
  return asString(body.instructions) ?? '';
}

function firstUserText(providerName: string, body: Dict): string {
  if (providerName === 'gemini') {
    const contents = asArray(body.contents);
    const first = contents?.find((c) => asString(asDict(c)?.role) === 'user');
    const parts = first ? asArray(asDict(first)?.parts) : null;
    if (!parts) return '';
    return parts.map((p) => asString(asDict(p)?.text) ?? '').filter(Boolean).join('\n');
  }
  const messages = asArray(body.messages) ?? asArray(body.input);
  const first = messages?.find((m) => asString(asDict(m)?.role) === 'user');
  return first ? contentToText(asDict(first)?.content) : '';
}

/**
 * Session id, in provenance-prefixed form:
 * - "s:<uuid>" — explicit id sent by the client. Claude Code puts a JSON string
 *   {"device_id":…,"session_id":…} in metadata.user_id (Anthropic Messages API).
 * - "h:<hash16>" — fallback: hash of provider + system prompt + first user message.
 *   Within an agent loop, request N+1's messages extend request N's, so both share
 *   the same first user message and hash into the same session.
 * The prefixes keep provenance visible and prevent a hash colliding with a real uuid.
 */
function extractSessionId(providerName: string, body: Dict): string | null {
  const userId = asString(asDict(body.metadata)?.user_id);
  if (userId) {
    try {
      const parsed = asDict(JSON.parse(userId));
      const sid = parsed && asString(parsed.session_id);
      if (sid) return `s:${sid}`;
    } catch {
      // metadata.user_id is an opaque string for non-Claude-Code clients
    }
  }

  const system = systemText(providerName, body);
  const firstUser = firstUserText(providerName, body);
  if (!system && !firstUser) return null;

  const hash = createHash('sha256')
    .update(`${providerName}\n${system}\n${firstUser}`)
    .digest('hex')
    .slice(0, 16);
  return `h:${hash}`;
}

const TURN_PROMPT_MAX_CHARS = 240;

/**
 * The last genuine user message in the request — the prompt that started the
 * current turn. Walks messages from the end; tool plumbing (tool_result
 * blocks, role:"tool" messages, functionResponse parts) yields empty text via
 * contentToText and is skipped, so agent-loop continuations resolve to the
 * same prompt as the turn's first request.
 */
function extractTurnPrompt(providerName: string, body: Dict): string | null {
  const messages =
    providerName === 'gemini'
      ? asArray(body.contents)
      : asArray(body.messages) ?? asArray(body.input);
  if (!messages) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = asDict(messages[i]);
    if (!message || asString(message.role) !== 'user') continue;
    const text =
      providerName === 'gemini'
        ? (asArray(message.parts) ?? [])
            .map((p) => asString(asDict(p)?.text) ?? '')
            .filter(Boolean)
            .join('\n')
        : contentToText(message.content);
    const trimmed = text.trim();
    if (trimmed) return trimmed.slice(0, TURN_PROMPT_MAX_CHARS);
  }
  return null;
}

/**
 * Claude Code identifies itself in a billing text block inside system[]:
 * "x-anthropic-billing-header: cc_version=2.1.153; cc_entrypoint=sdk-cli; …"
 */
function extractAgentIdentity(body: Dict): { entrypoint: string | null; version: string | null } {
  const system = asArray(body.system);
  if (!system) return { entrypoint: null, version: null };

  for (const block of system) {
    const text = asString(asDict(block)?.text);
    if (!text || !text.includes('cc_')) continue;
    const version = text.match(/cc_version=([^;\s]+)/)?.[1] ?? null;
    const entrypoint = text.match(/cc_entrypoint=([^;\s]+)/)?.[1] ?? null;
    if (version || entrypoint) return { entrypoint, version };
  }
  return { entrypoint: null, version: null };
}

function toolsDefinedCount(providerName: string, body: Dict): number | null {
  const tools = asArray(body.tools);
  if (!tools) return null;
  if (providerName === 'gemini') {
    // Gemini: tools is [{functionDeclarations: [...]}, ...]
    let count = 0;
    let found = false;
    for (const t of tools) {
      const declarations = asArray(asDict(t)?.functionDeclarations);
      if (declarations) {
        count += declarations.length;
        found = true;
      }
    }
    return found ? count : null;
  }
  return tools.length;
}

/**
 * Tool calls in the assistant response. Returns null when the response shape
 * is unrecognized (absence rule); an empty list when the response is a valid
 * assistant message that simply called no tools.
 */
function extractToolCalls(providerName: string, response: Dict): string[] | null {
  if (providerName === 'anthropic') {
    const content = asArray(response.content);
    if (!content) return null;
    return content
      .filter((b) => asString(asDict(b)?.type) === 'tool_use')
      .map((b) => asString(asDict(b)?.name) ?? 'unknown');
  }

  if (providerName === 'gemini') {
    const candidates = asArray(response.candidates);
    if (!candidates) return null;
    const names: string[] = [];
    for (const candidate of candidates) {
      const parts = asArray(asDict(asDict(candidate)?.content)?.parts) ?? [];
      for (const part of parts) {
        const call = asDict(asDict(part)?.functionCall);
        if (call) names.push(asString(call.name) ?? 'unknown');
      }
    }
    return names;
  }

  // OpenAI chat completions
  const choices = asArray(response.choices);
  if (choices) {
    const names: string[] = [];
    for (const choice of choices) {
      const calls = asArray(asDict(asDict(choice)?.message)?.tool_calls) ?? [];
      for (const call of calls) {
        const fn = asDict(asDict(call)?.function);
        names.push((fn && asString(fn.name)) ?? 'unknown');
      }
    }
    return names;
  }

  // OpenAI Responses API
  const output = asArray(response.output);
  if (output) {
    return output
      .filter((item) => asString(asDict(item)?.type) === 'function_call')
      .map((item) => asString(asDict(item)?.name) ?? 'unknown');
  }

  return null;
}

function extractStopReason(providerName: string, response: Dict): string | null {
  if (providerName === 'anthropic') return asString(response.stop_reason);
  if (providerName === 'gemini') {
    const candidates = asArray(response.candidates);
    return asString(asDict(candidates?.[0])?.finishReason);
  }
  const choices = asArray(response.choices);
  const finishReason = asString(asDict(choices?.[0])?.finish_reason);
  if (finishReason) return finishReason;
  // Responses API: surface why an incomplete response stopped
  const incomplete = asString(asDict(response.incomplete_details)?.reason);
  return incomplete ?? null;
}

function extractReasoningTokens(providerName: string, usage: Dict | null): number | null {
  if (!usage) return null;
  if (providerName === 'anthropic') {
    return asNumber(asDict(usage.output_tokens_details)?.thinking_tokens);
  }
  if (providerName === 'gemini') {
    return asNumber(usage.thoughtsTokenCount);
  }
  return (
    asNumber(asDict(usage.completion_tokens_details)?.reasoning_tokens) ??
    asNumber(asDict(usage.output_tokens_details)?.reasoning_tokens)
  );
}

function messageCount(providerName: string, body: Dict): number | null {
  if (providerName === 'gemini') return asArray(body.contents)?.length ?? null;
  return (asArray(body.messages) ?? asArray(body.input))?.length ?? null;
}

function byteLength(body: unknown): number | null {
  if (body === null || body === undefined) return null;
  try {
    return Buffer.byteLength(JSON.stringify(body), 'utf8');
  } catch {
    return null;
  }
}

export function extractAgentMeta(
  providerName: string,
  requestBody: unknown,
  responseBody: unknown,
  usage?: Record<string, unknown>,
  overrides?: AgentMetaOverrides
): AgentMeta {
  const request = asDict(requestBody);
  const response = asDict(responseBody);
  const usageDict = asDict(usage) ?? (response && asDict(response.usage ?? response.usageMetadata));

  const bodyIdentity = request && providerName === 'anthropic'
    ? extractAgentIdentity(request)
    : { entrypoint: null, version: null };
  const identity = {
    entrypoint: overrides?.agentEntrypoint ?? bodyIdentity.entrypoint,
    version: overrides?.agentVersion ?? bodyIdentity.version,
  };

  const toolCalls = response ? extractToolCalls(providerName, response) : null;

  return {
    sessionId: overrides?.sessionId ?? (request ? extractSessionId(providerName, request) : null),
    // Header-only for now: turns can't be recovered from stored bodies, so
    // backfill must never overwrite this column (headers aren't persisted).
    turnId: overrides?.turnId ?? null,
    turnPrompt: request ? extractTurnPrompt(providerName, request) : null,
    agentEntrypoint: identity.entrypoint,
    agentVersion: identity.version,
    toolsDefinedCount: request ? toolsDefinedCount(providerName, request) : null,
    toolCallsCount: toolCalls ? toolCalls.length : null,
    toolNames: toolCalls,
    reasoningTokens: extractReasoningTokens(providerName, usageDict),
    stopReason: response ? extractStopReason(providerName, response) : null,
    messageCount: request ? messageCount(providerName, request) : null,
    requestBytes: byteLength(requestBody),
    responseBytes: byteLength(responseBody),
  };
}
