import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { unlink, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { config } from './config.js';
import { logger } from './logger.js';
import type { RequestRecord } from './types.js';

// The DB is the source of truth; these files are a plain-JSON mirror of each
// request record, one file per request, for grepping / external tooling.
const dir = resolve(config.requestJsonDir);

let dirReady = false;

function ensureDir(): void {
  if (dirReady) return;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  dirReady = true;
}

function requestPath(id: string): string {
  return join(dir, `${id}.json`);
}

/**
 * Mirror one record to <requestJsonDir>/<id>.json. Fire-and-forget: a failed
 * write is logged but never fails the proxied request, whose row is already in
 * the DB. Returns the promise so tests can await the write.
 */
export function writeRequestFile(record: RequestRecord): Promise<void> {
  if (!config.saveRequestJson) return Promise.resolve();

  try {
    ensureDir();
  } catch (err) {
    logger.error(`Failed to create request JSON dir ${dir}`, { error: (err as Error).message });
    return Promise.resolve();
  }

  return writeFile(requestPath(record.id), JSON.stringify(record, null, 2)).catch((err: Error) => {
    logger.error(`Failed to write request JSON for ${record.id}`, { error: err.message });
  });
}

export function deleteRequestFile(id: string): Promise<void> {
  if (!config.saveRequestJson) return Promise.resolve();

  return unlink(requestPath(id)).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return;
    logger.error(`Failed to delete request JSON for ${id}`, { error: err.message });
  });
}

export function clearRequestFiles(): void {
  if (!config.saveRequestJson || !existsSync(dir)) return;

  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      rmSync(join(dir, name));
    } catch (err) {
      logger.error(`Failed to delete request JSON ${name}`, { error: (err as Error).message });
    }
  }
}

export function getRequestJsonDir(): string {
  return dir;
}
