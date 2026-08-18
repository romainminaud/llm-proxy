import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { backfillAgentMeta } from './backfill.js';
import { logger } from './logger.js';

let db: Database.Database | null = null;

const MIGRATIONS = [
  // Migration 1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    request_body TEXT NOT NULL,
    response_body TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    input_tokens INTEGER,
    total_input_tokens INTEGER,
    non_cached_input_tokens INTEGER,
    cached_input_tokens INTEGER,
    output_tokens INTEGER,
    cached_tokens INTEGER,
    cache_write_tokens INTEGER,
    input_cost REAL,
    cached_cost REAL,
    cache_write_cost REAL,
    output_cost REAL,
    total_cost REAL,
    error TEXT,
    replay_of TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_requests_model ON requests(model);
  CREATE INDEX IF NOT EXISTS idx_requests_provider ON requests(provider);
  CREATE INDEX IF NOT EXISTS idx_requests_replay_of ON requests(replay_of);
  `,

  // Migration 2: Add schema version table
  `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  );
  `,

  // Migration 3: Agentic metadata (sessions, tool calls, reasoning tokens).
  // All columns nullable: null means "provider couldn't say", never 0.
  `
  ALTER TABLE requests ADD COLUMN session_id TEXT;
  ALTER TABLE requests ADD COLUMN agent_entrypoint TEXT;
  ALTER TABLE requests ADD COLUMN agent_version TEXT;
  ALTER TABLE requests ADD COLUMN tools_defined_count INTEGER;
  ALTER TABLE requests ADD COLUMN tool_calls_count INTEGER;
  ALTER TABLE requests ADD COLUMN tool_names TEXT;
  ALTER TABLE requests ADD COLUMN reasoning_tokens INTEGER;
  ALTER TABLE requests ADD COLUMN stop_reason TEXT;
  ALTER TABLE requests ADD COLUMN message_count INTEGER;
  ALTER TABLE requests ADD COLUMN request_bytes INTEGER;
  ALTER TABLE requests ADD COLUMN response_bytes INTEGER;

  CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
  `,

  // Migration 4: turn grouping within a session. Header-provided only
  // (x-llm-proxy-turn-id) — not derivable from stored bodies, so backfill
  // leaves it untouched.
  `
  ALTER TABLE requests ADD COLUMN turn_id TEXT;

  CREATE INDEX IF NOT EXISTS idx_requests_session_turn ON requests(session_id, turn_id);
  `,

  // Migration 5: last genuine user message snippet — labels a turn with the
  // prompt that started it. Body-derived, so the backfill populates old rows.
  `
  ALTER TABLE requests ADD COLUMN turn_prompt TEXT;
  `,
];

function getCurrentVersion(database: Database.Database): number {
  try {
    const result = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).get() as { name: string } | undefined;

    if (!result) {
      return 0;
    }

    const versionResult = database.prepare(
      'SELECT MAX(version) as version FROM schema_migrations'
    ).get() as { version: number | null };

    return versionResult?.version ?? 0;
  } catch {
    return 0;
  }
}

function runMigrations(database: Database.Database): number[] {
  const currentVersion = getCurrentVersion(database);
  logger.info(`Database at version ${currentVersion}, ${MIGRATIONS.length} migrations available`);

  const applied: number[] = [];

  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    const migration = MIGRATIONS[i];
    logger.info(`Running migration ${i + 1}...`);

    database.exec(migration);
    applied.push(i + 1);

    // Record the migration (skip for migration 1 since table doesn't exist yet)
    if (i >= 1) {
      database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(i + 1);
    }

    logger.info(`Migration ${i + 1} completed`);
  }

  // Insert version 1 and 2 after both migrations run if starting fresh
  if (currentVersion === 0 && MIGRATIONS.length >= 2) {
    database.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(1);
    database.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(2);
  }

  return applied;
}

export function initDatabase(dbPath: string): Database.Database {
  if (db) {
    return db;
  }

  // Ensure directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  logger.info(`Opening database at ${dbPath}`);

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('foreign_keys = ON');

  // Run migrations
  const applied = runMigrations(db);

  // Migrations 3 and 5 added extracted agentic columns; populate them from
  // the verbatim stored bodies exactly once, right after the columns appear.
  if (applied.includes(3) || applied.includes(5)) {
    backfillAgentMeta(db);
  }

  logger.info('Database initialized successfully');

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database closed');
  }
}
