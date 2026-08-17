import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'

const tempDir = mkdtempSync(join(tmpdir(), 'llm-proxy-backfill-'))
const dbPath = join(tempDir, 'llm-proxy.db')

after(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

// Build a version-2 database by hand (pre-agentic schema), with one stored
// Claude Code style request, then let initDatabase migrate + backfill it.
const V2_SCHEMA = `
  CREATE TABLE requests (
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
  CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  );
  INSERT INTO schema_migrations (version) VALUES (1);
  INSERT INTO schema_migrations (version) VALUES (2);
`

test('migration 3 applies to a v2 database and backfills agentic columns', async () => {
  const legacy = new Database(dbPath)
  legacy.exec(V2_SCHEMA)

  const requestBody = {
    model: 'claude-opus-4-7',
    metadata: { user_id: JSON.stringify({ device_id: 'd', session_id: 'legacy-session' }) },
    system: [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.0.0; cc_entrypoint=sdk-cli' }],
    tools: [{ name: 'Read' }],
    messages: [{ role: 'user', content: 'hi' }],
  }
  const responseBody = {
    type: 'message',
    role: 'assistant',
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }],
    usage: { input_tokens: 5, output_tokens: 10, output_tokens_details: { thinking_tokens: 3 } },
  }

  legacy.prepare(`
    INSERT INTO requests (id, timestamp, method, path, provider, request_body, response_body)
    VALUES (?, ?, 'POST', '/v1/messages', 'anthropic', ?, ?)
  `).run('legacy-1', new Date().toISOString(), JSON.stringify(requestBody), JSON.stringify(responseBody))
  legacy.close()

  const { initDatabase } = await import('../src/database.ts')
  const db = initDatabase(dbPath)

  const version = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number }
  // Latest schema version (migration 4 added turn_id)
  assert.equal(version.v, 4)

  const row = db.prepare(
    'SELECT session_id, agent_entrypoint, agent_version, tool_calls_count, tool_names, reasoning_tokens, stop_reason, message_count FROM requests WHERE id = ?'
  ).get('legacy-1') as Record<string, unknown>

  assert.equal(row.session_id, 's:legacy-session')
  assert.equal(row.agent_entrypoint, 'sdk-cli')
  assert.equal(row.agent_version, '2.0.0')
  assert.equal(row.tool_calls_count, 1)
  assert.deepEqual(JSON.parse(row.tool_names as string), ['Read'])
  assert.equal(row.reasoning_tokens, 3)
  assert.equal(row.stop_reason, 'tool_use')
  assert.equal(row.message_count, 1)
})
