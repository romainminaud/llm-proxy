import { readFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { config } from './config.js';
import type { ModelStats, RequestRecord, SaveRequestInput, Stats } from './types.js';

const dataDir = resolve(config.dataDir);

// Ensure data directory exists
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

function getRequestPath(id: string) {
  return join(dataDir, `${id}.json`);
}

function getAllRequestFiles() {
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir)
    .filter(f => f.endsWith('.json'))
    .map(f => join(dataDir, f));
}

function loadRequest(filePath: string): RequestRecord | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as RequestRecord;
  } catch {
    return null;
  }
}

export function saveRequest(data: SaveRequestInput) {
  const totalInputTokens = data.totalInputTokens ?? data.inputTokens ?? null;
  const cachedInputTokens = data.cachedInputTokens ?? data.cachedTokens ?? null;
  let nonCachedInputTokens = data.nonCachedInputTokens ?? null;
  if (
    nonCachedInputTokens === null
    && totalInputTokens !== null
    && cachedInputTokens !== null
  ) {
    nonCachedInputTokens = cachedInputTokens > totalInputTokens
      ? totalInputTokens
      : Math.max(0, totalInputTokens - cachedInputTokens);
  }

  const request: RequestRecord = {
    id: data.id,
    timestamp: data.timestamp,
    method: data.method,
    path: data.path,
    provider: data.provider,
    model: data.model ?? null,
    request_body: data.requestBody,
    response_body: data.responseBody ?? null,
    status_code: data.statusCode ?? null,
    duration_ms: data.durationMs ?? null,
    input_tokens: totalInputTokens,
    total_input_tokens: totalInputTokens,
    non_cached_input_tokens: nonCachedInputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: data.outputTokens ?? null,
    cached_tokens: cachedInputTokens,
    cache_write_tokens: data.cacheWriteTokens ?? null,
    input_cost: data.inputCost ?? null,
    cached_cost: data.cachedCost ?? null,
    cache_write_cost: data.cacheWriteCost ?? null,
    output_cost: data.outputCost ?? null,
    total_cost: data.totalCost ?? null,
    error: data.error ?? null,
    replay_of: data.replayOf ?? null,
  };
  // Non-blocking async write - returns promise for testing but callers don't need to await
  return writeFile(getRequestPath(data.id), JSON.stringify(request)).catch(err => {
    console.error(`Failed to save request ${data.id}:`, err);
  });
}

export function getRequests(
  { limit = 100, offset = 0, model = null }: { limit?: number; offset?: number; model?: string | null } = {}
) {
  const files = getAllRequestFiles();

  // Load all requests and sort by timestamp descending
  let requests: RequestRecord[] = files
    .map(loadRequest)
    .filter((request): request is RequestRecord => request !== null)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (model) {
    requests = requests.filter(r => r.model === model);
  }

  return requests.slice(offset, offset + limit);
}

export function getRequest(id: string): RequestRecord | null {
  const filePath = getRequestPath(id);
  if (!existsSync(filePath)) return null;
  return loadRequest(filePath);
}

export function getStats(): Stats {
  const files = getAllRequestFiles();
  const requests = files.map(loadRequest).filter((request): request is RequestRecord => request !== null);

  const totalRequests = requests.length;
  const totalCost = requests.reduce((sum, r) => sum + (r.total_cost || 0), 0);
  const totalInputTokens = requests.reduce(
    (sum, r) => sum + (r.total_input_tokens ?? r.input_tokens ?? 0),
    0
  );
  const totalOutputTokens = requests.reduce((sum, r) => sum + (r.output_tokens || 0), 0);

  // Group by model
  const modelMap: Record<string, ModelStats> = {};
  for (const r of requests) {
    if (!r.model) continue;
    if (!modelMap[r.model]) {
      modelMap[r.model] = { model: r.model, count: 0, input_tokens: 0, output_tokens: 0, total_cost: 0 };
    }
    modelMap[r.model].count++;
    modelMap[r.model].input_tokens += r.total_input_tokens ?? r.input_tokens ?? 0;
    modelMap[r.model].output_tokens += r.output_tokens || 0;
    modelMap[r.model].total_cost += r.total_cost || 0;
  }

  const byModel = Object.values(modelMap).sort((a, b) => b.count - a.count);

  return {
    totalRequests,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    byModel,
  };
}

export function deleteRequest(id: string) {
  const filePath = getRequestPath(id);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

export function clearAll() {
  const files = getAllRequestFiles();
  for (const file of files) {
    unlinkSync(file);
  }
}
