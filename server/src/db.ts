import { resolve } from 'path';
import { config } from './config.js';
import { getDatabase, initDatabase } from './database.js';
import type { ModelStats, RequestRecord, SaveRequestInput, Stats } from './types.js';

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
};

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
  };
}

export function saveRequest(data: SaveRequestInput): void {
  const db = getDatabase();

  const totalInputTokens = data.totalInputTokens ?? data.inputTokens ?? null;
  const cachedInputTokens = data.cachedInputTokens ?? data.cachedTokens ?? null;
  let nonCachedInputTokens = data.nonCachedInputTokens ?? null;

  if (
    nonCachedInputTokens === null &&
    totalInputTokens !== null &&
    cachedInputTokens !== null
  ) {
    nonCachedInputTokens =
      cachedInputTokens > totalInputTokens
        ? totalInputTokens
        : Math.max(0, totalInputTokens - cachedInputTokens);
  }

  const stmt = db.prepare(`
    INSERT INTO requests (
      id, timestamp, method, path, provider, model,
      request_body, response_body, status_code, duration_ms,
      input_tokens, total_input_tokens, non_cached_input_tokens, cached_input_tokens,
      output_tokens, cached_tokens, cache_write_tokens,
      input_cost, cached_cost, cache_write_cost, output_cost, total_cost,
      error, replay_of
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?
    )
  `);

  stmt.run(
    data.id,
    data.timestamp,
    data.method,
    data.path,
    data.provider,
    data.model,
    JSON.stringify(data.requestBody),
    data.responseBody ? JSON.stringify(data.responseBody) : null,
    data.statusCode,
    data.durationMs,
    totalInputTokens,
    totalInputTokens,
    nonCachedInputTokens,
    cachedInputTokens,
    data.outputTokens ?? null,
    cachedInputTokens,
    data.cacheWriteTokens ?? null,
    data.inputCost,
    data.cachedCost,
    data.cacheWriteCost,
    data.outputCost,
    data.totalCost,
    data.error ?? null,
    data.replayOf ?? null
  );
}

export function getRequests({
  limit = 100,
  offset = 0,
  model = null,
}: { limit?: number; offset?: number; model?: string | null } = {}): RequestRecord[] {
  const db = getDatabase();

  let query = 'SELECT * FROM requests';
  const params: (string | number)[] = [];

  if (model) {
    query += ' WHERE model = ?';
    params.push(model);
  }

  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as RequestRow[];
  return rows.map(rowToRecord);
}

export function getRequest(id: string): RequestRecord | null {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as RequestRow | undefined;

  if (!row) return null;
  return rowToRecord(row);
}

export function getStats(): Stats {
  const db = getDatabase();

  // Get aggregate stats
  const totals = db.prepare(`
    SELECT
      COUNT(*) as totalRequests,
      COALESCE(SUM(total_cost), 0) as totalCost,
      COALESCE(SUM(COALESCE(total_input_tokens, input_tokens, 0)), 0) as totalInputTokens,
      COALESCE(SUM(COALESCE(output_tokens, 0)), 0) as totalOutputTokens
    FROM requests
  `).get() as {
    totalRequests: number;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
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

  return {
    totalRequests: totals.totalRequests,
    totalCost: totals.totalCost,
    totalInputTokens: totals.totalInputTokens,
    totalOutputTokens: totals.totalOutputTokens,
    byModel: byModelRows,
  };
}

export function deleteRequest(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM requests WHERE id = ?').run(id);
}

export function clearAll(): void {
  const db = getDatabase();
  db.prepare('DELETE FROM requests').run();
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
