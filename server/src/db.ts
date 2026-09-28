import { resolve } from 'path';
import { extractReasoningSnippet, extractResponseSnippet, extractToolCallDetails, type ToolCallDetail } from './agent-meta.js';
import { config } from './config.js';
import { getDatabase, initDatabase } from './database.js';
import { clearRequestFiles, deleteRequestFile, writeRequestFile } from './request-files.js';
import type {
  ModelStats,
  RequestRecord,
  SaveRequestInput,
  SessionDetail,
  SessionRequest,
  SessionSummary,
  Stats,
  TurnDetail,
  TurnListItem,
  TurnModelStat,
  TurnSummary,
} from './types.js';

// Initialize database
const dbPath = resolve(config.databasePath);
initDatabase(dbPath);

type RequestRow = {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  provider: string;
  model: string | null;
  request_body: string;
  response_body: string | null;
  status_code: number | null;
  duration_ms: number | null;
  input_tokens: number | null;
  total_input_tokens: number | null;
  non_cached_input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  cache_write_tokens: number | null;
  input_cost: number | null;
  cached_cost: number | null;
  cache_write_cost: number | null;
  output_cost: number | null;
  total_cost: number | null;
  error: string | null;
  replay_of: string | null;
  session_id: string | null;
  turn_id: string | null;
  turn_prompt: string | null;
  agent_entrypoint: string | null;
  agent_version: string | null;
  tools_defined_count: number | null;
  tool_calls_count: number | null;
  tool_names: string | null;
  reasoning_tokens: number | null;
  stop_reason: string | null;
  message_count: number | null;
  request_bytes: number | null;
  response_bytes: number | null;
};

function parseToolNames(text: string | null): string[] | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function rowToRecord(row: RequestRow): RequestRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    method: row.method,
    path: row.path,
    provider: row.provider,
    model: row.model,
    request_body: row.request_body ? JSON.parse(row.request_body) : null,
    response_body: row.response_body ? JSON.parse(row.response_body) : null,
    status_code: row.status_code,
    duration_ms: row.duration_ms,
    input_tokens: row.input_tokens,
    total_input_tokens: row.total_input_tokens,
    non_cached_input_tokens: row.non_cached_input_tokens,
    cached_input_tokens: row.cached_input_tokens,
    output_tokens: row.output_tokens,
    cached_tokens: row.cached_tokens,
    cache_write_tokens: row.cache_write_tokens,
    input_cost: row.input_cost,
    cached_cost: row.cached_cost,
    cache_write_cost: row.cache_write_cost,
    output_cost: row.output_cost,
    total_cost: row.total_cost,
    error: row.error,
    replay_of: row.replay_of,
    session_id: row.session_id,
    turn_id: row.turn_id,
    turn_prompt: row.turn_prompt,
    agent_entrypoint: row.agent_entrypoint,
    agent_version: row.agent_version,
    tools_defined_count: row.tools_defined_count,
    tool_calls_count: row.tool_calls_count,
    tool_names: parseToolNames(row.tool_names),
    reasoning_tokens: row.reasoning_tokens,
    stop_reason: row.stop_reason,
    message_count: row.message_count,
    request_bytes: row.request_bytes,
    response_bytes: row.response_bytes,
  };
}

export function saveRequest(data: SaveRequestInput): Promise<void> {
  const db = getDatabase();

  const totalInputTokens = data.totalInputTokens ?? data.inputTokens ?? null;
  const cachedInputTokens = data.cachedInputTokens ?? data.cachedTokens ?? null;
  let nonCachedInputTokens = data.nonCachedInputTokens ?? null;

  // Fallback for callers that only supply totals. Callers that know the
  // provider convention (recordUsage, replay) pass the split explicitly via
  // getTokenSplit; this assumes the total already includes cached tokens.
  if (
    nonCachedInputTokens === null &&
    totalInputTokens !== null &&
    cachedInputTokens !== null
  ) {
    nonCachedInputTokens = Math.max(0, totalInputTokens - cachedInputTokens);
  }

  // Built once, then written to both the row and the JSON mirror so the two
  // can never drift.
  const record: RequestRecord = {
    id: data.id,
    timestamp: data.timestamp,
    method: data.method,
    path: data.path,
    provider: data.provider,
    model: data.model,
    request_body: data.requestBody,
    response_body: data.responseBody ?? null,
    status_code: data.statusCode,
    duration_ms: data.durationMs,
    input_tokens: totalInputTokens,
    total_input_tokens: totalInputTokens,
    non_cached_input_tokens: nonCachedInputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: data.outputTokens ?? null,
    cached_tokens: cachedInputTokens,
    cache_write_tokens: data.cacheWriteTokens ?? null,
    input_cost: data.inputCost,
    cached_cost: data.cachedCost,
    cache_write_cost: data.cacheWriteCost,
    output_cost: data.outputCost,
    total_cost: data.totalCost,
    error: data.error ?? null,
    replay_of: data.replayOf ?? null,
    session_id: data.sessionId ?? null,
    turn_id: data.turnId ?? null,
    turn_prompt: data.turnPrompt ?? null,
    agent_entrypoint: data.agentEntrypoint ?? null,
    agent_version: data.agentVersion ?? null,
    tools_defined_count: data.toolsDefinedCount ?? null,
    tool_calls_count: data.toolCallsCount ?? null,
    tool_names: data.toolNames ?? null,
    reasoning_tokens: data.reasoningTokens ?? null,
    stop_reason: data.stopReason ?? null,
    message_count: data.messageCount ?? null,
    request_bytes: data.requestBytes ?? null,
    response_bytes: data.responseBytes ?? null,
  };

  const stmt = db.prepare(`
    INSERT INTO requests (
      id, timestamp, method, path, provider, model,
      request_body, response_body, status_code, duration_ms,
      input_tokens, total_input_tokens, non_cached_input_tokens, cached_input_tokens,
      output_tokens, cached_tokens, cache_write_tokens,
      input_cost, cached_cost, cache_write_cost, output_cost, total_cost,
      error, replay_of,
      session_id, turn_id, turn_prompt, agent_entrypoint, agent_version,
      tools_defined_count, tool_calls_count, tool_names,
      reasoning_tokens, stop_reason, message_count,
      request_bytes, response_bytes
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )
  `);

  stmt.run(
    record.id,
    record.timestamp,
    record.method,
    record.path,
    record.provider,
    record.model,
    JSON.stringify(record.request_body),
    record.response_body ? JSON.stringify(record.response_body) : null,
    record.status_code,
    record.duration_ms,
    record.input_tokens,
    record.total_input_tokens,
    record.non_cached_input_tokens,
    record.cached_input_tokens,
    record.output_tokens,
    record.cached_tokens,
    record.cache_write_tokens,
    record.input_cost,
    record.cached_cost,
    record.cache_write_cost,
    record.output_cost,
    record.total_cost,
    record.error,
    record.replay_of,
    record.session_id,
    record.turn_id,
    record.turn_prompt,
    record.agent_entrypoint,
    record.agent_version,
    record.tools_defined_count,
    record.tool_calls_count,
    record.tool_names ? JSON.stringify(record.tool_names) : null,
    record.reasoning_tokens,
    record.stop_reason,
    record.message_count,
    record.request_bytes,
    record.response_bytes
  );

  // Non-blocking: callers may ignore the promise, tests can await it.
  return writeRequestFile(record);
}

type RequestFilters = {
  model?: string | null;
  provider?: string | null;
  sessionId?: string | null;
};

function buildRequestFilters({ model, provider, sessionId }: RequestFilters) {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (model) {
    clauses.push('model = ?');
    params.push(model);
  }
  if (provider) {
    clauses.push('provider = ?');
    params.push(provider);
  }
  if (sessionId) {
    clauses.push('session_id = ?');
    params.push(sessionId);
  }

  return {
    where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export function getRequests({
  limit = 100,
  offset = 0,
  ...filters
}: { limit?: number; offset?: number } & RequestFilters = {}): RequestRecord[] {
  const db = getDatabase();

  const { where, params } = buildRequestFilters(filters);
  const query = `SELECT * FROM requests${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;

  const rows = db.prepare(query).all(...params, limit, offset) as RequestRow[];
  return rows.map(rowToRecord);
}

export function countRequests(filters: RequestFilters = {}): number {
  const db = getDatabase();
  const { where, params } = buildRequestFilters(filters);
  const result = db
    .prepare(`SELECT COUNT(*) as count FROM requests${where}`)
    .get(...params) as { count: number };
  return result.count;
}

export function getRequest(id: string): RequestRecord | null {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as RequestRow | undefined;

  if (!row) return null;
  return rowToRecord(row);
}

type SessionRollupRow = {
  session_id: string;
  request_count: number;
  turn_count: number;
  error_count: number;
  started_at: string;
  ended_at: string;
  api_ms: number;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_cost: number;
  tool_calls: number;
  models: string | null;
  agent_entrypoint: string | null;
  agent_version: string | null;
  last_stop_reason: string | null;
};

// Shared SELECT list for session rollups (list + single-session detail).
// input_tokens is the non-cached component, so the cache-hit denominator
// (input + cacheRead + cacheWrite) equals the true context size.
const SESSION_ROLLUP_SELECT = `
  SELECT
    session_id,
    COUNT(*) AS request_count,
    COUNT(DISTINCT turn_id) AS turn_count,
    SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS error_count,
    MIN(timestamp) AS started_at,
    MAX(timestamp) AS ended_at,
    SUM(COALESCE(duration_ms, 0)) AS api_ms,
    SUM(COALESCE(non_cached_input_tokens, 0)) AS input_tokens,
    SUM(COALESCE(cached_input_tokens, 0)) AS cache_read_tokens,
    SUM(COALESCE(cache_write_tokens, 0)) AS cache_write_tokens,
    SUM(COALESCE(output_tokens, 0)) AS output_tokens,
    SUM(COALESCE(reasoning_tokens, 0)) AS reasoning_tokens,
    SUM(COALESCE(total_cost, 0)) AS total_cost,
    SUM(COALESCE(tool_calls_count, 0)) AS tool_calls,
    GROUP_CONCAT(DISTINCT model) AS models,
    MAX(agent_entrypoint) AS agent_entrypoint,
    MAX(agent_version) AS agent_version,
    (
      SELECT r2.stop_reason FROM requests r2
      WHERE r2.session_id = requests.session_id
      ORDER BY r2.timestamp DESC, r2.id DESC LIMIT 1
    ) AS last_stop_reason
  FROM requests
`;

function rollupToSummary(row: SessionRollupRow): SessionSummary {
  const contextTokens = row.input_tokens + row.cache_read_tokens + row.cache_write_tokens;
  const wallMs = Date.parse(row.ended_at) - Date.parse(row.started_at);

  return {
    session_id: row.session_id,
    request_count: row.request_count,
    turn_count: row.turn_count,
    error_count: row.error_count,
    started_at: row.started_at,
    ended_at: row.ended_at,
    wall_ms: Number.isFinite(wallMs) ? wallMs : 0,
    api_ms: row.api_ms,
    input_tokens: row.input_tokens,
    cache_read_tokens: row.cache_read_tokens,
    cache_write_tokens: row.cache_write_tokens,
    output_tokens: row.output_tokens,
    reasoning_tokens: row.reasoning_tokens,
    total_cost: row.total_cost,
    tool_calls: row.tool_calls,
    // Absence rule: null when no input tokens were observed, never a fake 0%
    cache_hit_ratio: contextTokens > 0 ? row.cache_read_tokens / contextTokens : null,
    models: row.models ? row.models.split(',').filter(Boolean) : [],
    agent_entrypoint: row.agent_entrypoint,
    agent_version: row.agent_version,
    last_stop_reason: row.last_stop_reason,
  };
}

export function getSessions({
  limit = 50,
  offset = 0,
}: { limit?: number; offset?: number } = {}): SessionSummary[] {
  const db = getDatabase();

  const rows = db.prepare(`
    ${SESSION_ROLLUP_SELECT}
    WHERE session_id IS NOT NULL
    GROUP BY session_id
    ORDER BY ended_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as SessionRollupRow[];

  return rows.map(rollupToSummary);
}

export function countSessions(): number {
  const db = getDatabase();
  const result = db.prepare(
    'SELECT COUNT(DISTINCT session_id) as count FROM requests WHERE session_id IS NOT NULL'
  ).get() as { count: number };
  return result.count;
}

type TimelineRow = Omit<RequestRow, 'request_body' | 'response_body'> & { seq: number };

// Timeline without the (potentially huge) body columns; bodies are fetched
// per-request via getRequest when the user drills in.
function queryTimeline(clauses: string[], params: (string | number)[]): TimelineRow[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      id, timestamp, method, path, provider, model, status_code, duration_ms,
      input_tokens, total_input_tokens, non_cached_input_tokens, cached_input_tokens,
      output_tokens, cached_tokens, cache_write_tokens,
      input_cost, cached_cost, cache_write_cost, output_cost, total_cost,
      error, replay_of,
      session_id, turn_id, agent_entrypoint, agent_version,
      tools_defined_count, tool_calls_count, tool_names,
      reasoning_tokens, stop_reason, message_count, request_bytes, response_bytes,
      ROW_NUMBER() OVER (ORDER BY timestamp, id) AS seq
    FROM requests
    WHERE ${clauses.join(' AND ')}
    ORDER BY timestamp, id
  `).all(...params) as TimelineRow[];
}

function buildTimeline(rows: TimelineRow[]): {
  requests: SessionRequest[];
  toolUsage: Record<string, number>;
} {
  const toolUsage: Record<string, number> = {};
  let previousTotalInput: number | null = null;

  const requests: SessionRequest[] = rows.map((row) => {
    const toolNames = parseToolNames(row.tool_names);
    for (const name of toolNames ?? []) {
      toolUsage[name] = (toolUsage[name] ?? 0) + 1;
    }

    const totalInput = row.total_input_tokens;
    const contextGrowth =
      totalInput !== null && previousTotalInput !== null ? totalInput - previousTotalInput : null;
    if (totalInput !== null) previousTotalInput = totalInput;

    return {
      id: row.id,
      timestamp: row.timestamp,
      method: row.method,
      path: row.path,
      provider: row.provider,
      model: row.model,
      status_code: row.status_code,
      duration_ms: row.duration_ms,
      input_tokens: row.input_tokens,
      total_input_tokens: row.total_input_tokens,
      non_cached_input_tokens: row.non_cached_input_tokens,
      cached_input_tokens: row.cached_input_tokens,
      output_tokens: row.output_tokens,
      cached_tokens: row.cached_tokens,
      cache_write_tokens: row.cache_write_tokens,
      input_cost: row.input_cost,
      cached_cost: row.cached_cost,
      cache_write_cost: row.cache_write_cost,
      output_cost: row.output_cost,
      total_cost: row.total_cost,
      error: row.error,
      replay_of: row.replay_of,
      session_id: row.session_id,
      turn_id: row.turn_id,
      agent_entrypoint: row.agent_entrypoint,
      agent_version: row.agent_version,
      tools_defined_count: row.tools_defined_count,
      tool_calls_count: row.tool_calls_count,
      tool_names: toolNames,
      reasoning_tokens: row.reasoning_tokens,
      stop_reason: row.stop_reason,
      message_count: row.message_count,
      request_bytes: row.request_bytes,
      response_bytes: row.response_bytes,
      seq: row.seq,
      context_growth: contextGrowth,
    };
  });

  return { requests, toolUsage };
}

export function getSessionDetail(sessionId: string): SessionDetail | null {
  const db = getDatabase();

  const rollup = db.prepare(`
    ${SESSION_ROLLUP_SELECT}
    WHERE session_id = ?
    GROUP BY session_id
  `).get(sessionId) as SessionRollupRow | undefined;

  if (!rollup) return null;

  const rows = queryTimeline(['session_id = ?'], [sessionId]);
  const { requests, toolUsage } = buildTimeline(rows);

  // Per-turn rollups for requests the client tagged with x-llm-proxy-turn-id.
  // Untagged requests stay in the flat timeline only.
  const turnRows = db.prepare(`
    SELECT
      turn_id,
      ROW_NUMBER() OVER (ORDER BY MIN(timestamp), turn_id) AS turn_number,
      (
        SELECT r3.turn_prompt FROM requests r3
        WHERE r3.session_id IS requests.session_id AND r3.turn_id = requests.turn_id
        ORDER BY r3.timestamp ASC, r3.id ASC LIMIT 1
      ) AS turn_prompt,
      COUNT(*) AS request_count,
      SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS error_count,
      MIN(timestamp) AS started_at,
      MAX(timestamp) AS ended_at,
      SUM(COALESCE(duration_ms, 0)) AS api_ms,
      SUM(COALESCE(non_cached_input_tokens, 0)) AS input_tokens,
      SUM(COALESCE(cached_input_tokens, 0)) AS cache_read_tokens,
      SUM(COALESCE(cache_write_tokens, 0)) AS cache_write_tokens,
      SUM(COALESCE(output_tokens, 0)) AS output_tokens,
      SUM(COALESCE(reasoning_tokens, 0)) AS reasoning_tokens,
      SUM(COALESCE(total_cost, 0)) AS total_cost,
      SUM(COALESCE(tool_calls_count, 0)) AS tool_calls,
      (
        SELECT r2.stop_reason FROM requests r2
        WHERE r2.session_id = requests.session_id AND r2.turn_id = requests.turn_id
        ORDER BY r2.timestamp DESC, r2.id DESC LIMIT 1
      ) AS last_stop_reason
    FROM requests
    WHERE session_id = ? AND turn_id IS NOT NULL
    GROUP BY turn_id
    ORDER BY started_at, turn_id
  `).all(sessionId) as (Omit<TurnSummary, 'wall_ms' | 'by_model'>)[];

  const turnModels = turnModelStats(' AND session_id = ?', [sessionId]);
  const turns: TurnSummary[] = turnRows.map((row) => {
    const wallMs = Date.parse(row.ended_at) - Date.parse(row.started_at);
    return {
      ...row,
      wall_ms: Number.isFinite(wallMs) ? wallMs : 0,
      by_model: turnModels.get(`${sessionId}\u0000${row.turn_id}`) ?? [],
    };
  });

  const byModel = db.prepare(`
    SELECT
      model,
      COUNT(*) as count,
      COALESCE(SUM(COALESCE(total_input_tokens, input_tokens, 0)), 0) as input_tokens,
      COALESCE(SUM(COALESCE(output_tokens, 0)), 0) as output_tokens,
      COALESCE(SUM(total_cost), 0) as total_cost
    FROM requests
    WHERE session_id = ? AND model IS NOT NULL
    GROUP BY model
    ORDER BY count DESC
  `).all(sessionId) as ModelStats[];

  return {
    session: rollupToSummary(rollup),
    requests,
    turns,
    tool_usage: toolUsage,
    by_model: byModel,
  };
}

// Cross-session turns list: one row per (session, turn), newest first.
// Turns are only ever header-tagged, so untagged traffic never appears here.
type TurnListRow = Omit<TurnListItem, 'wall_ms' | 'models' | 'by_model'> & { models: string | null };

// Per-(session, turn) cost split by model, keyed "session\u0000turn".
// One grouped query instead of a correlated lookup per turn row.
function turnModelStats(extraClause: string, params: string[]): Map<string, TurnModelStat[]> {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT session_id, turn_id, model,
      COUNT(*) AS count,
      SUM(COALESCE(total_cost, 0)) AS total_cost
    FROM requests
    WHERE turn_id IS NOT NULL AND model IS NOT NULL${extraClause}
    GROUP BY session_id, turn_id, model
    ORDER BY total_cost DESC
  `).all(...params) as (TurnModelStat & { session_id: string | null; turn_id: string })[];

  const map = new Map<string, TurnModelStat[]>();
  for (const row of rows) {
    const key = `${row.session_id ?? ''}\u0000${row.turn_id}`;
    const list = map.get(key) ?? [];
    list.push({ model: row.model, count: row.count, total_cost: row.total_cost });
    map.set(key, list);
  }
  return map;
}

const TURN_LIST_SELECT = `
  SELECT
    session_id,
    turn_id,
    ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY MIN(timestamp), turn_id) AS turn_number,
    (
      SELECT r3.turn_prompt FROM requests r3
      WHERE r3.session_id IS requests.session_id AND r3.turn_id = requests.turn_id
      ORDER BY r3.timestamp ASC, r3.id ASC LIMIT 1
    ) AS turn_prompt,
    COUNT(*) AS request_count,
    SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS error_count,
    MIN(timestamp) AS started_at,
    MAX(timestamp) AS ended_at,
    SUM(COALESCE(duration_ms, 0)) AS api_ms,
    SUM(COALESCE(non_cached_input_tokens, 0)) AS input_tokens,
    SUM(COALESCE(cached_input_tokens, 0)) AS cache_read_tokens,
    SUM(COALESCE(cache_write_tokens, 0)) AS cache_write_tokens,
    SUM(COALESCE(output_tokens, 0)) AS output_tokens,
    SUM(COALESCE(reasoning_tokens, 0)) AS reasoning_tokens,
    SUM(COALESCE(total_cost, 0)) AS total_cost,
    SUM(COALESCE(tool_calls_count, 0)) AS tool_calls,
    GROUP_CONCAT(DISTINCT model) AS models,
    MAX(agent_entrypoint) AS agent_entrypoint,
    (
      SELECT r2.stop_reason FROM requests r2
      WHERE r2.session_id IS requests.session_id AND r2.turn_id = requests.turn_id
      ORDER BY r2.timestamp DESC, r2.id DESC LIMIT 1
    ) AS last_stop_reason
  FROM requests
`;

function turnRowToItem(row: TurnListRow): Omit<TurnListItem, 'by_model'> {
  const wallMs = Date.parse(row.ended_at) - Date.parse(row.started_at);
  return {
    ...row,
    wall_ms: Number.isFinite(wallMs) ? wallMs : 0,
    models: row.models ? row.models.split(',').filter(Boolean) : [],
  };
}

export function getTurns({
  limit = 100,
  offset = 0,
}: { limit?: number; offset?: number } = {}): TurnListItem[] {
  const db = getDatabase();

  const rows = db.prepare(`
    ${TURN_LIST_SELECT}
    WHERE turn_id IS NOT NULL
    GROUP BY session_id, turn_id
    ORDER BY ended_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as TurnListRow[];

  const models = turnModelStats('', []);
  return rows.map((row) => ({
    ...turnRowToItem(row),
    by_model: models.get(`${row.session_id ?? ''}\u0000${row.turn_id}`) ?? [],
  }));
}

export function getTurnDetail(sessionId: string, turnId: string): TurnDetail | null {
  const db = getDatabase();

  const rollup = db.prepare(`
    ${TURN_LIST_SELECT}
    WHERE session_id = ? AND turn_id = ?
    GROUP BY session_id, turn_id
  `).get(sessionId, turnId) as TurnListRow | undefined;

  if (!rollup) return null;

  // The shared SELECT's ROW_NUMBER ranks within the filtered set (always 1
  // here), so recompute the ordinal against every turn in the session.
  const numberRow = db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT turn_id AS tid, MIN(timestamp) AS started FROM requests
      WHERE session_id = ? AND turn_id IS NOT NULL
      GROUP BY turn_id
    ) WHERE started < ? OR (started = ? AND tid <= ?)
  `).get(sessionId, rollup.started_at, rollup.started_at, turnId) as { n: number };

  const rows = queryTimeline(['session_id = ?', 'turn_id = ?'], [sessionId, turnId]);
  const { requests, toolUsage } = buildTimeline(rows);

  // Turn drill-down enrichment: a turn is a handful of requests, so loading
  // their response bodies to surface tool arguments (which file was read /
  // patched) and the assistant's answer snippet is affordable here — unlike
  // on the full session timeline.
  const bodyRows = db.prepare(`
    SELECT id, provider, response_body FROM requests
    WHERE session_id = ? AND turn_id = ?
  `).all(sessionId, turnId) as Array<{ id: string; provider: string; response_body: string | null }>;

  const activityById = new Map<string, {
    tool_call_details: ToolCallDetail[] | null;
    response_snippet: string | null;
    reasoning_snippet: string | null;
  }>();
  for (const row of bodyRows) {
    if (!row.response_body) continue;
    try {
      const body: unknown = JSON.parse(row.response_body);
      activityById.set(row.id, {
        tool_call_details: extractToolCallDetails(row.provider, body),
        response_snippet: extractResponseSnippet(row.provider, body),
        reasoning_snippet: extractReasoningSnippet(row.provider, body),
      });
    } catch {
      // unparseable body → leave the request unenriched
    }
  }
  for (const request of requests) {
    const activity = activityById.get(request.id);
    if (activity) {
      request.tool_call_details = activity.tool_call_details;
      request.response_snippet = activity.response_snippet;
      request.reasoning_snippet = activity.reasoning_snippet;
    }
  }

  const models = turnModelStats(' AND session_id = ? AND turn_id = ?', [sessionId, turnId]);

  return {
    turn: {
      ...turnRowToItem(rollup),
      turn_number: numberRow.n,
      by_model: models.get(`${sessionId}\u0000${turnId}`) ?? [],
    },
    requests,
    tool_usage: toolUsage,
  };
}

export function countTurns(): number {
  const db = getDatabase();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT 1 FROM requests WHERE turn_id IS NOT NULL GROUP BY session_id, turn_id
    )
  `).get() as { count: number };
  return result.count;
}

export function getStats(): Stats {
  const db = getDatabase();

  // Get aggregate stats
  const totals = db.prepare(`
    SELECT
      COUNT(*) as totalRequests,
      COALESCE(SUM(total_cost), 0) as totalCost,
      COALESCE(SUM(COALESCE(total_input_tokens, input_tokens, 0)), 0) as totalInputTokens,
      COALESCE(SUM(COALESCE(output_tokens, 0)), 0) as totalOutputTokens,
      COALESCE(SUM(COALESCE(non_cached_input_tokens, 0)), 0) as nonCachedInputTokens,
      COALESCE(SUM(COALESCE(cached_input_tokens, 0)), 0) as totalCacheReadTokens,
      COALESCE(SUM(COALESCE(cache_write_tokens, 0)), 0) as totalCacheWriteTokens,
      COALESCE(SUM(COALESCE(reasoning_tokens, 0)), 0) as totalReasoningTokens,
      COUNT(DISTINCT session_id) as sessionCount
    FROM requests
  `).get() as {
    totalRequests: number;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    nonCachedInputTokens: number;
    totalCacheReadTokens: number;
    totalCacheWriteTokens: number;
    totalReasoningTokens: number;
    sessionCount: number;
  };

  // Get stats by model
  const byModelRows = db.prepare(`
    SELECT
      model,
      COUNT(*) as count,
      COALESCE(SUM(COALESCE(total_input_tokens, input_tokens, 0)), 0) as input_tokens,
      COALESCE(SUM(COALESCE(output_tokens, 0)), 0) as output_tokens,
      COALESCE(SUM(total_cost), 0) as total_cost
    FROM requests
    WHERE model IS NOT NULL
    GROUP BY model
    ORDER BY count DESC
  `).all() as ModelStats[];

  const contextTokens =
    totals.nonCachedInputTokens + totals.totalCacheReadTokens + totals.totalCacheWriteTokens;

  return {
    totalRequests: totals.totalRequests,
    totalCost: totals.totalCost,
    totalInputTokens: totals.totalInputTokens,
    totalOutputTokens: totals.totalOutputTokens,
    totalCacheReadTokens: totals.totalCacheReadTokens,
    totalCacheWriteTokens: totals.totalCacheWriteTokens,
    totalReasoningTokens: totals.totalReasoningTokens,
    cacheHitRatio: contextTokens > 0 ? totals.totalCacheReadTokens / contextTokens : null,
    sessionCount: totals.sessionCount,
    byModel: byModelRows,
  };
}

export function deleteRequest(id: string): Promise<void> {
  const db = getDatabase();
  db.prepare('DELETE FROM requests WHERE id = ?').run(id);
  return deleteRequestFile(id);
}

export function clearAll(): void {
  const db = getDatabase();
  db.prepare('DELETE FROM requests').run();
  clearRequestFiles();
}

export function getRequestCount(): number {
  const db = getDatabase();
  const result = db.prepare('SELECT COUNT(*) as count FROM requests').get() as { count: number };
  return result.count;
}

export function getRequestsByTimeRange(
  startTime: string,
  endTime: string,
  { limit = 1000 }: { limit?: number } = {}
): RequestRecord[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT * FROM requests
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(startTime, endTime, limit) as RequestRow[];

  return rows.map(rowToRecord);
}
