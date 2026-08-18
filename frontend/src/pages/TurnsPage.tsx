import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ErrorBoundary from '../components/ErrorBoundary'
import RequestDetail from '../components/RequestDetail'
import RequestTimelineTable from '../components/RequestTimelineTable'
import TurnsTable from '../components/TurnsTable'
import { Badge } from '@/components/ui/badge'
import type { RequestRecord, TurnDetail, TurnListItem } from '../types'
import { shortSessionId } from '../utils/toolCalls'
import { formatDuration, formatTokens, ordinal, stripModelSuffix } from '../utils/format'
import { PageSubtitle, PageTitle, StatCard, StatsRow } from './SessionsPage'

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
    <div>
      <PageTitle>Turns</PageTitle>
      <PageSubtitle>
        Requests grouped into turns via the <code>x-llm-proxy-turn-id</code> header, across all sessions.
      </PageSubtitle>
      <TurnsTable
        turns={turns}
        showSession
        loaded={loaded}
        emptyMessage={
          <>No turns yet — send <code>x-llm-proxy-turn-id</code> headers with your requests.</>
        }
      />
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

  if (notFound) {
    return <div className="rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">Turn not found</div>
  }
  if (!detail) return <div className="text-ink-muted">Loading…</div>

  const { turn, requests, tool_usage } = detail
  const toolEntries = Object.entries(tool_usage).sort((a, b) => b[1] - a[1])
  const contextTokens = turn.input_tokens + turn.cache_read_tokens + turn.cache_write_tokens
  const cacheHitRatio = contextTokens > 0 ? turn.cache_read_tokens / contextTokens : null

  return (
    <div>
      <PageTitle>
        <Link to="/turns" className="text-accent hover:underline">Turns</Link>
        <span className="text-ink-muted"> / </span>
        <Link
          to={`/sessions/${encodeURIComponent(turn.session_id)}`}
          className="font-mono text-lg text-accent hover:underline"
          title={turn.session_id}
        >
          {shortSessionId(turn.session_id)}
        </Link>
        <span className="text-ink-muted"> / </span>
        <span className="font-mono text-lg" title={turn.turn_id}>{turn.turn_id}</span>
        <span className="ml-2 align-middle font-sans text-[13px] font-normal text-ink-tertiary">
          {ordinal(turn.turn_number)} turn of the session
        </span>
      </PageTitle>
      {turn.turn_prompt && (
        <p className="mb-5 max-w-3xl text-[13px] leading-5 text-ink-secondary">
          {turn.turn_prompt}
        </p>
      )}
      {!turn.turn_prompt && <div className="mb-5" />}

      <StatsRow>
        <StatCard
          label="Requests"
          value={
            <>
              {turn.request_count}
              {turn.error_count > 0 && <span className="text-danger"> ({turn.error_count}✗)</span>}
            </>
          }
        />
        <StatCard
          label="Wall / API time"
          value={`${formatDuration(turn.wall_ms)} / ${formatDuration(turn.api_ms)}`}
        />
        <StatCard
          label="Cache read / write"
          value={`${formatTokens(turn.cache_read_tokens)} / ${formatTokens(turn.cache_write_tokens)}`}
        />
        <StatCard
          label="Cache hit"
          value={cacheHitRatio === null ? '—' : `${Math.round(cacheHitRatio * 100)}%`}
        />
        <StatCard label="Output" value={formatTokens(turn.output_tokens)} />
        <StatCard label="Tool calls" value={turn.tool_calls} />
        <StatCard label="Cost" value={`$${turn.total_cost.toFixed(4)}`} />
      </StatsRow>

      {(turn.agent_entrypoint || turn.models.length > 0) && (
        <p className="mb-4 text-[13px] text-ink-tertiary">
          {turn.agent_entrypoint && (
            <>Agent: <Badge>{turn.agent_entrypoint}</Badge>{' · '}</>
          )}
          Models: {turn.models.map(stripModelSuffix).join(', ')}
        </p>
      )}

      {toolEntries.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1">
          {toolEntries.map(([name, count]) => (
            <Badge variant="outline" key={name}>
              {name}{count > 1 ? ` ×${count}` : ''}
            </Badge>
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
