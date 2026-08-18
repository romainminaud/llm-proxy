// Manual backfill entry point: npm run backfill
// Re-runs agentic-metadata extraction over all stored requests, e.g. after
// improving extraction rules in agent-meta.ts.
import Database from 'better-sqlite3';
import { resolve } from 'path';
import { backfillAgentMeta } from './backfill.js';
import { config } from './config.js';

const dbPath = resolve(config.databasePath);
const db = new Database(dbPath);
try {
  backfillAgentMeta(db);
} finally {
  db.close();
}
