import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ErrorBoundary from '../components/ErrorBoundary'
import RequestDetail from '../components/RequestDetail'
import RequestTimelineTable from '../components/RequestTimelineTable'
import type { RequestRecord, SessionDetail, SessionSummary } from '../types'
import { formatRatio, shortSessionId } from '../utils/toolCalls'
import { formatDuration, formatTokens, stripModelSuffix } from '../utils/format'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const AUTO_REFRESH_MS = 10000

type SessionInsights = {
  tools_schema_bytes: number | null
  tools_schema_est_tokens: number | null
  system_prompt_bytes: number | null
  system_prompt_est_tokens: number | null
  cache_control_blocks: number | null
  ephemeral_5m_tokens: number | null
  ephemeral_1h_tokens: number | null
  largest_tool_results: Array<{ tool: string; bytes: number; est_tokens: number }>
  cache_invalidation_warnings: Array<{ turn: number; wrote: number; next_read: number }>
}

function SessionsList() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/sessions?limit=100`)
    if (res.ok) setSessions(await res.json())
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
    const interval = window.setInterval(load, AUTO_REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [load])

  return (
    <div className="logs-page">
      <h1 className="page-title">Sessions</h1>
      <p className="page-subtitle muted">
        Requests grouped into agent sessions — <code>s:</code> ids come from the client
        (Claude Code session id), <code>h:</code> ids from a conversation-prefix heuristic.
      </p>
      <div className="table-wrap">
        <table className="requests-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Agent</th>
              <th>Started</th>
              <th>Wall / API</th>
              <th>Turns</th>
              <th>Reqs</th>
              <th>Models</th>
              <th>Input</th>
              <th>Cache Read</th>
              <th>Cache Write</th>
              <th>Output</th>
              <th>Reasoning</th>
              <th>Cache Hit</th>
              <th>Tools</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(session => (
              <tr key={session.session_id} className={session.error_count > 0 ? 'error-row' : ''}>
                <td>
                  <Link
                    to={`/sessions/${encodeURIComponent(session.session_id)}`}
                    className="session-link"
                    title={session.session_id}
                  >
                    {shortSessionId(session.session_id)}
                  </Link>
                </td>
                <td>
                  {session.agent_entrypoint ? (
                    <span className="model-badge" title={session.agent_version ?? undefined}>
                      {session.agent_entrypoint}
                    </span>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </td>
                <td>{new Date(session.started_at).toLocaleString()}</td>
                <td className="duration">
                  {formatDuration(session.wall_ms)} / {formatDuration(session.api_ms)}
                </td>
                <td className="tokens">
                  {session.turn_count > 0 ? session.turn_count : <span className="muted">-</span>}
                </td>
                <td className="tokens">
                  {session.request_count}
                  {session.error_count > 0 && (
                    <span className="muted" title="failed requests"> ({session.error_count}✗)</span>
                  )}
                </td>
                <td>
                  {session.models.map(model => (
                    <span key={model} className="model-badge">{stripModelSuffix(model)}</span>
                  ))}
                </td>
                <td className="tokens">{formatTokens(session.input_tokens)}</td>
                <td className="tokens">{formatTokens(session.cache_read_tokens)}</td>
                <td className="tokens">{formatTokens(session.cache_write_tokens)}</td>
                <td className="tokens">{formatTokens(session.output_tokens)}</td>
                <td className="tokens">{formatTokens(session.reasoning_tokens)}</td>
                <td className="tokens">{formatRatio(session.cache_hit_ratio)}</td>
                <td className="tokens">{session.tool_calls}</td>
                <td className="cost">${session.total_cost.toFixed(4)}</td>
              </tr>
            ))}
            {loaded && sessions.length === 0 && (
              <tr><td colSpan={15} className="muted">No sessions yet — proxy some agent traffic first.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InsightsPanel({ insights }: { insights: SessionInsights }) {
  return (
    <div className="insights-panel">
      <h3>Insights</h3>
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Tools schema (est)</div>
          <div className="stat-value">
            {insights.tools_schema_est_tokens !== null
              ? `~${formatTokens(insights.tools_schema_est_tokens)} tok`
              : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">System prompt (est)</div>
          <div className="stat-value">
            {insights.system_prompt_est_tokens !== null
              ? `~${formatTokens(insights.system_prompt_est_tokens)} tok`
              : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">cache_control blocks</div>
          <div className="stat-value">{insights.cache_control_blocks ?? '—'}</div>
        </div>
        {(insights.ephemeral_5m_tokens !== null || insights.ephemeral_1h_tokens !== null) && (
          <div className="stat-card">
            <div className="stat-label">Cache TTL (5m / 1h)</div>
            <div className="stat-value">
              {formatTokens(insights.ephemeral_5m_tokens)} / {formatTokens(insights.ephemeral_1h_tokens)}
            </div>
          </div>
        )}
      </div>
      {insights.cache_invalidation_warnings.length > 0 && (
        <div className="error-banner">
          Cache prefix likely invalidated after turn{insights.cache_invalidation_warnings.length > 1 ? 's' : ''}{' '}
          {insights.cache_invalidation_warnings.map(w => w.turn).join(', ')} — the next request re-read far
          less than what was cached (wrote {insights.cache_invalidation_warnings.map(w => formatTokens(w.wrote)).join(', ')} tokens).
        </div>
      )}
      {insights.largest_tool_results.length > 0 && (
        <div className="insights-tool-results">
          <div className="stat-label">Largest tool results in context</div>
          {insights.largest_tool_results.map((r, i) => (
            <div key={i} className="insights-tool-row">
              <span className="tool-call-badge">{r.tool}</span>
              <span className="tokens">~{formatTokens(r.est_tokens)} tok ({(r.bytes / 1024).toFixed(1)} KB)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SessionDetailView({ sessionId }: { sessionId: string }) {
  const [detail, setDetail] = useState<(SessionDetail & { insights?: SessionInsights }) | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<RequestRecord | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}?insights=1`)
      .then(res => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(data => { if (!cancelled) setDetail(data) })
      .catch(() => { if (!cancelled) setNotFound(true) })
    return () => { cancelled = true }
  }, [sessionId])

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(null), 1500)
    } catch {
      window.prompt('Copy ID:', id)
    }
  }

  const openRequest = async (id: string) => {
    const res = await fetch(`${API_BASE}/api/requests/${id}`)
    if (res.ok) setSelectedRequest(await res.json())
  }

  if (notFound) return <div className="logs-page"><div className="error-banner">Session not found</div></div>
  if (!detail) return <div className="logs-page"><div className="muted">Loading…</div></div>

  const { session, requests, turns, tool_usage, by_model, insights } = detail
  const turnLinkBase = `/turns/${encodeURIComponent(session.session_id)}`
  const toolEntries = Object.entries(tool_usage).sort((a, b) => b[1] - a[1])
  const modelToolTime = session.wall_ms - session.api_ms

  return (
    <div className="logs-page">
      <h1 className="page-title">
        <Link to="/sessions" className="session-link">Sessions</Link>
        {' / '}
        <span title={session.session_id}>{shortSessionId(session.session_id)}</span>
      </h1>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Requests</div>
          <div className="stat-value">{session.request_count}</div>
        </div>
        {turns && turns.length > 0 && (
          <div className="stat-card">
            <div className="stat-label">Turns</div>
            <div className="stat-value">{turns.length}</div>
          </div>
        )}
        <div className="stat-card">
          <div className="stat-label">Wall / API time</div>
          <div className="stat-value" title={`~${formatDuration(Math.max(0, modelToolTime))} in tools/user time`}>
            {formatDuration(session.wall_ms)} / {formatDuration(session.api_ms)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cache Hit</div>
          <div className="stat-value">{formatRatio(session.cache_hit_ratio)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cache Read / Write</div>
          <div className="stat-value">
            {formatTokens(session.cache_read_tokens)} / {formatTokens(session.cache_write_tokens)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Output</div>
          <div className="stat-value">{formatTokens(session.output_tokens)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tool Calls</div>
          <div className="stat-value">{session.tool_calls}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Cost</div>
          <div className="stat-value cost">${session.total_cost.toFixed(4)}</div>
        </div>
      </div>

      {session.agent_entrypoint && (
        <p className="muted">
          Agent: <span className="model-badge">{session.agent_entrypoint}</span>
          {session.agent_version ? ` v${session.agent_version}` : ''} · Models:{' '}
          {by_model.map(m => `${stripModelSuffix(m.model)} (${m.count})`).join(', ')}
        </p>
      )}

      {insights && <InsightsPanel insights={insights} />}

      {toolEntries.length > 0 && (
        <div className="tool-call-list session-tools">
          {toolEntries.map(([name, count]) => (
            <span key={name} className="tool-call-badge">
              {name}{count > 1 ? ` ×${count}` : ''}
            </span>
          ))}
        </div>
      )}

      {turns && turns.length > 0 && (
        <>
          <h2 className="section-title">Turns</h2>
          <div className="table-wrap">
            <table className="requests-table">
              <thead>
                <tr>
                  <th>Turn</th>
                  <th>Started</th>
                  <th>Wall / API</th>
                  <th>Reqs</th>
                  <th>Input</th>
                  <th>Cache Read</th>
                  <th>Cache Write</th>
                  <th>Output</th>
                  <th>Reasoning</th>
                  <th>Tools</th>
                  <th>Stop</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {turns.map(turn => (
                  <tr key={turn.turn_id} className={turn.error_count > 0 ? 'error-row' : ''}>
                    <td>
                      <Link
                        to={`${turnLinkBase}/${encodeURIComponent(turn.turn_id)}`}
                        className="session-link turn-id"
                        title={turn.turn_id}
                      >
                        {turn.turn_id}
                      </Link>
                    </td>
                    <td>{new Date(turn.started_at).toLocaleTimeString()}</td>
                    <td className="duration">
                      {formatDuration(turn.wall_ms)} / {formatDuration(turn.api_ms)}
                    </td>
                    <td className="tokens">
                      {turn.request_count}
                      {turn.error_count > 0 && (
                        <span className="muted" title="failed requests"> ({turn.error_count}✗)</span>
                      )}
                    </td>
                    <td className="tokens">{formatTokens(turn.input_tokens)}</td>
                    <td className="tokens">{formatTokens(turn.cache_read_tokens)}</td>
                    <td className="tokens">{formatTokens(turn.cache_write_tokens)}</td>
                    <td className="tokens">{formatTokens(turn.output_tokens)}</td>
                    <td className="tokens">{formatTokens(turn.reasoning_tokens)}</td>
                    <td className="tokens">{turn.tool_calls}</td>
                    <td>
                      {turn.last_stop_reason
                        ? <span className="stop-reason-badge">{turn.last_stop_reason}</span>
                        : <span className="muted">-</span>}
                    </td>
                    <td className="cost">${turn.total_cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className="section-title">Requests</h2>
        </>
      )}

      <RequestTimelineTable
        requests={requests}
        turns={turns}
        turnLinkBase={turnLinkBase}
        onView={openRequest}
      />

      {selectedRequest && (
        <div className="modal" onClick={() => setSelectedRequest(null)}>
          <div className="modal-content modal-large" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Request Details</h3>
              <button className="close-btn" onClick={() => setSelectedRequest(null)}>&times;</button>
            </div>
            <ErrorBoundary fallback={<div className="error-banner">Failed to render request details</div>}>
              <RequestDetail
                request={selectedRequest}
                apiBase={API_BASE}
                onCopyId={copyId}
                copiedId={copiedId}
              />
            </ErrorBoundary>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SessionsPage() {
  const { id } = useParams<{ id: string }>()
  if (id) return <SessionDetailView sessionId={id} />
  return <SessionsList />
}
