import type Database from 'better-sqlite3';
import { extractAgentMeta } from './agent-meta.js';
import { logger } from './logger.js';

// Only imports the pure agent-meta module (never db.ts/database.ts helpers,
// which would create an import cycle — database.ts calls into this file).

type BackfillRow = {
  id: string;
  provider: string;
  request_body: string | null;
  response_body: string | null;
};

const BATCH_SIZE = 500;

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Re-extract agentic metadata from the verbatim stored bodies into the
 * migration-3 columns. Idempotent — safe to re-run after extraction
 * improvements (npm run backfill).
 */
export function backfillAgentMeta(db: Database.Database): void {
  const rows = db
    .prepare('SELECT id, provider, request_body, response_body FROM requests')
    .all() as BackfillRow[];

  if (rows.length === 0) {
    return;
  }

  logger.info(`Backfilling agentic metadata for ${rows.length} requests...`);

  const update = db.prepare(`
    UPDATE requests SET
      session_id = ?,
      turn_prompt = ?,
      agent_entrypoint = ?,
      agent_version = ?,
      tools_defined_count = ?,
      tool_calls_count = ?,
      tool_names = ?,
      reasoning_tokens = ?,
      stop_reason = ?,
      message_count = ?,
      request_bytes = ?,
      response_bytes = ?
    WHERE id = ?
  `);

  const updateBatch = db.transaction((batch: BackfillRow[]) => {
    for (const row of batch) {
      const requestBody = parseJson(row.request_body);
      const responseBody = parseJson(row.response_body);
      const meta = extractAgentMeta(row.provider, requestBody, responseBody);
      // turn_id is deliberately not backfilled: it comes only from the
      // x-llm-proxy-turn-id header, which isn't stored. turn_prompt is
      // body-derived, so old rows do get it.
      update.run(
        meta.sessionId,
        meta.turnPrompt,
        meta.agentEntrypoint,
        meta.agentVersion,
        meta.toolsDefinedCount,
        meta.toolCallsCount,
        meta.toolNames ? JSON.stringify(meta.toolNames) : null,
        meta.reasoningTokens,
        meta.stopReason,
        meta.messageCount,
        meta.requestBytes,
        meta.responseBytes,
        row.id
      );
    }
  });

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    updateBatch(rows.slice(i, i + BATCH_SIZE));
  }

  logger.info(`Backfill complete (${rows.length} requests)`);
}
