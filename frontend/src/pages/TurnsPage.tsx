import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ErrorBoundary from '../components/ErrorBoundary'
import RequestDetail from '../components/RequestDetail'
import RequestTimelineTable from '../components/RequestTimelineTable'
import type { RequestRecord, TurnDetail, TurnListItem } from '../types'
import { shortSessionId } from '../utils/toolCalls'
import { formatDuration, formatTokens, stripModelSuffix } from '../utils/format'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const AUTO_REFRESH_MS = 10000

function TurnsList() {
  const [turns, setTurns] = useState<TurnListItem[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/turns?limit=200`)
    if (res.ok) setTurns(await res.json())
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
    const interval = window.setInterval(load, AUTO_REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [load])

  return (
    <div className="logs-page">
      <h1 className="page-title">Turns</h1>
      <p className="page-subtitle muted">
        Requests grouped into turns via the <code>x-llm-proxy-turn-id</code> header, across all sessions.
      </p>
      <div className="table-wrap">
        <table className="requests-table">
          <thead>
            <tr>
              <th>Turn</th>
              <th>Session</th>
              <th>Agent</th>
              <th>Started</th>
              <th>Wall / API</th>
              <th>Reqs</th>
              <th>Models</th>
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
              <tr
                key={`${turn.session_id}:${turn.turn_id}`}
                className={turn.error_count > 0 ? 'error-row' : ''}
              >
                <td>
                  {turn.session_id ? (
                    <Link
                      to={`/turns/${encodeURIComponent(turn.session_id)}/${encodeURIComponent(turn.turn_id)}`}
                      className="session-link turn-id"
                      title={turn.turn_id}
                    >
                      {turn.turn_id}
                    </Link>
                  ) : (
                    <span className="turn-id" title={turn.turn_id}>{turn.turn_id}</span>
                  )}
                </td>
                <td>
                  {turn.session_id ? (
                    <Link
                      to={`/sessions/${encodeURIComponent(turn.session_id)}`}
                      className="session-link"
                      title={turn.session_id}
                    >
                      {shortSessionId(turn.session_id)}
                    </Link>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </td>
                <td>
                  {turn.agent_entrypoint
                    ? <span className="model-badge">{turn.agent_entrypoint}</span>
                    : <span className="muted">-</span>}
                </td>
                <td>{new Date(turn.started_at).toLocaleString()}</td>
                <td className="duration">
                  {formatDuration(turn.wall_ms)} / {formatDuration(turn.api_ms)}
                </td>
                <td className="tokens">
                  {turn.request_count}
                  {turn.error_count > 0 && (
                    <span className="muted" title="failed requests"> ({turn.error_count}✗)</span>
                  )}
                </td>
                <td>
                  {turn.models.map(model => (
                    <span key={model} className="model-badge">{stripModelSuffix(model)}</span>
                  ))}
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
            {loaded && turns.length === 0 && (
              <tr>
                <td colSpan={15} className="muted">
                  No turns yet — send <code>x-llm-proxy-turn-id</code> headers with your requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TurnDetailView({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const [detail, setDetail] = useState<TurnDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<RequestRecord | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(data => { if (!cancelled) setDetail(data) })
      .catch(() => { if (!cancelled) setNotFound(true) })
    return () => { cancelled = true }
  }, [sessionId, turnId])

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

  if (notFound) return <div className="logs-page"><div className="error-banner">Turn not found</div></div>
  if (!detail) return <div className="logs-page"><div className="muted">Loading…</div></div>

  const { turn, requests, tool_usage } = detail
  const toolEntries = Object.entries(tool_usage).sort((a, b) => b[1] - a[1])
  const contextTokens = turn.input_tokens + turn.cache_read_tokens + turn.cache_write_tokens
  const cacheHitRatio = contextTokens > 0 ? turn.cache_read_tokens / contextTokens : null

  return (
    <div className="logs-page">
      <h1 className="page-title">
        <Link to="/turns" className="session-link">Turns</Link>
        {' / '}
        <Link
          to={`/sessions/${encodeURIComponent(turn.session_id)}`}
          className="session-link"
          title={turn.session_id}
        >
          {shortSessionId(turn.session_id)}
        </Link>
        {' / '}
        <span className="turn-id" title={turn.turn_id}>{turn.turn_id}</span>
      </h1>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Requests</div>
          <div className="stat-value">
            {turn.request_count}
            {turn.error_count > 0 && <span className="muted"> ({turn.error_count}✗)</span>}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Wall / API time</div>
          <div className="stat-value">
            {formatDuration(turn.wall_ms)} / {formatDuration(turn.api_ms)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cache Read / Write</div>
          <div className="stat-value">
            {formatTokens(turn.cache_read_tokens)} / {formatTokens(turn.cache_write_tokens)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cache Hit</div>
          <div className="stat-value">
            {cacheHitRatio === null ? '—' : `${Math.round(cacheHitRatio * 100)}%`}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Output</div>
          <div className="stat-value">{formatTokens(turn.output_tokens)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tool Calls</div>
          <div className="stat-value">{turn.tool_calls}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cost</div>
          <div className="stat-value cost">${turn.total_cost.toFixed(4)}</div>
        </div>
      </div>

      {(turn.agent_entrypoint || turn.models.length > 0) && (
        <p className="muted">
          {turn.agent_entrypoint && (
            <>Agent: <span className="model-badge">{turn.agent_entrypoint}</span>{' · '}</>
          )}
          Models: {turn.models.map(stripModelSuffix).join(', ')}
        </p>
      )}

      {toolEntries.length > 0 && (
        <div className="tool-call-list session-tools">
          {toolEntries.map(([name, count]) => (
            <span key={name} className="tool-call-badge">
              {name}{count > 1 ? ` ×${count}` : ''}
            </span>
          ))}
        </div>
      )}

      <RequestTimelineTable requests={requests} onView={openRequest} />

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

export default function TurnsPage() {
  const { sessionId, turnId } = useParams<{ sessionId: string; turnId: string }>()
  if (sessionId && turnId) return <TurnDetailView sessionId={sessionId} turnId={turnId} />
  return <TurnsList />
}
