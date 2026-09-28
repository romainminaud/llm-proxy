import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ErrorBoundary from '../components/ErrorBoundary'
import RequestDetail from '../components/RequestDetail'
import RequestTimelineTable from '../components/RequestTimelineTable'
import TurnsTable from '../components/TurnsTable'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableNum,
  TableRow,
} from '@/components/ui/table'
import type { RequestRecord, SessionDetail, SessionSummary } from '../types'
import { formatRatio, shortSessionId } from '../utils/toolCalls'
import { compactTokens, formatDuration, formatTokens, stripModelSuffix } from '../utils/format'

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

export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="mb-1 text-xl font-semibold tracking-tight text-ink">{children}</h1>
}

export function PageSubtitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-5 text-[13px] text-ink-tertiary">{children}</p>
}

export type StatItem = { label: string; value: React.ReactNode; title?: string }

// Compact KPI row: one slim bordered strip instead of a grid of cards.
// Falsy items are skipped so callers can include stats conditionally.
export function StatStrip({ items }: { items: Array<StatItem | null | false | undefined> }) {
  const visible = items.filter((item): item is StatItem => Boolean(item))
  return (
    <div className="mb-5 flex flex-wrap items-baseline gap-x-8 gap-y-2 rounded-lg border border-line-subtle bg-surface px-4 py-2.5">
      {visible.map(item => (
        <div key={item.label} title={item.title}>
          <div className="microlabel">{item.label}</div>
          <div className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums leading-5 text-ink">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  )
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
    <div>
      <PageTitle>Sessions</PageTitle>
      <PageSubtitle>
        Requests grouped into agent sessions — <code>s:</code> ids come from the client
        (Claude Code session id), <code>h:</code> ids from a conversation-prefix heuristic.
      </PageSubtitle>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Session</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Wall / API</TableHead>
            <TableHead className="text-right">Turns</TableHead>
            <TableHead className="text-right">Reqs</TableHead>
            <TableHead>Models</TableHead>
            <TableHead className="text-right">Input</TableHead>
            <TableHead className="text-right">Cache read</TableHead>
            <TableHead className="text-right">Cache write</TableHead>
            <TableHead className="text-right">Output</TableHead>
            <TableHead className="text-right">Reasoning</TableHead>
            <TableHead className="text-right">Cache hit</TableHead>
            <TableHead className="text-right">Tools</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map(session => (
            <TableRow key={session.session_id} data-state={session.error_count > 0 ? 'error' : undefined}>
              <TableCell>
                <Link
                  to={`/sessions/${encodeURIComponent(session.session_id)}`}
                  className="font-mono text-xs text-accent hover:underline"
                  title={session.session_id}
                >
                  {shortSessionId(session.session_id)}
                </Link>
              </TableCell>
              <TableCell>
                {session.agent_entrypoint ? (
                  <Badge title={session.agent_version ?? undefined}>{session.agent_entrypoint}</Badge>
                ) : (
                  <span className="text-ink-muted">-</span>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-ink-tertiary">
                {new Date(session.started_at).toLocaleString()}
              </TableCell>
              <TableNum>
                {formatDuration(session.wall_ms)} / {formatDuration(session.api_ms)}
              </TableNum>
              <TableNum>
                {session.turn_count > 0 ? session.turn_count : <span className="text-ink-muted">-</span>}
              </TableNum>
              <TableNum>
                {session.request_count}
                {session.error_count > 0 && (
                  <span className="text-danger" title="failed requests"> ({session.error_count}✗)</span>
                )}
              </TableNum>
              <TableCell className="max-w-48">
                <div className="flex flex-wrap gap-1">
                  {session.models.map(model => (
                    <Badge key={model}>{stripModelSuffix(model)}</Badge>
                  ))}
                </div>
              </TableCell>
              <TableNum>{formatTokens(session.input_tokens)}</TableNum>
              <TableNum>{formatTokens(session.cache_read_tokens)}</TableNum>
              <TableNum>{formatTokens(session.cache_write_tokens)}</TableNum>
              <TableNum>{formatTokens(session.output_tokens)}</TableNum>
              <TableNum>{formatTokens(session.reasoning_tokens)}</TableNum>
              <TableNum>{formatRatio(session.cache_hit_ratio)}</TableNum>
              <TableNum>{session.tool_calls}</TableNum>
              <TableNum className="font-medium text-ink">${session.total_cost.toFixed(4)}</TableNum>
            </TableRow>
          ))}
          {loaded && sessions.length === 0 && (
            <TableRow>
              <TableCell colSpan={15} className="py-8 text-center text-ink-muted">
                No sessions yet — proxy some agent traffic first.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function InsightsPanel({ insights }: { insights: SessionInsights }) {
  return (
    <div className="mb-5">
      <div className="microlabel mb-2">Insights</div>
      <StatStrip
        items={[
          {
            label: 'Tools schema (est)',
            value: insights.tools_schema_est_tokens !== null
              ? `~${formatTokens(insights.tools_schema_est_tokens)} tok`
              : '—',
          },
          {
            label: 'System prompt (est)',
            value: insights.system_prompt_est_tokens !== null
              ? `~${formatTokens(insights.system_prompt_est_tokens)} tok`
              : '—',
          },
          { label: 'cache_control blocks', value: insights.cache_control_blocks ?? '—' },
          (insights.ephemeral_5m_tokens !== null || insights.ephemeral_1h_tokens !== null) && {
            label: 'Cache TTL (5m / 1h)',
            value: `${formatTokens(insights.ephemeral_5m_tokens)} / ${formatTokens(insights.ephemeral_1h_tokens)}`,
          },
        ]}
      />
      {insights.cache_invalidation_warnings.length > 0 && (
        <div className="mb-4 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          Cache prefix likely invalidated after turn{insights.cache_invalidation_warnings.length > 1 ? 's' : ''}{' '}
          {insights.cache_invalidation_warnings.map(w => w.turn).join(', ')} — the next request re-read far
          less than what was cached (wrote {insights.cache_invalidation_warnings.map(w => formatTokens(w.wrote)).join(', ')} tokens).
        </div>
      )}
      {insights.largest_tool_results.length > 0 && (
        <div className="mb-4">
          <div className="microlabel mb-1.5">Largest tool results in context</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {insights.largest_tool_results.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                <Badge variant="outline">{r.tool}</Badge>
                <span className="font-mono text-xs tabular-nums text-ink-tertiary">
                  ~{formatTokens(r.est_tokens)} tok ({(r.bytes / 1024).toFixed(1)} KB)
                </span>
              </span>
            ))}
          </div>
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

  if (notFound) {
    return <div className="rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">Session not found</div>
  }
  if (!detail) return <div className="text-ink-muted">Loading…</div>

  const { session, requests, turns, tool_usage, by_model, insights } = detail
  const turnLinkBase = `/turns/${encodeURIComponent(session.session_id)}`
  const toolEntries = Object.entries(tool_usage).sort((a, b) => b[1] - a[1])
  const modelToolTime = session.wall_ms - session.api_ms

  return (
    <div>
      <PageTitle>
        <Link to="/sessions" className="text-accent hover:underline">Sessions</Link>
        <span className="text-ink-muted"> / </span>
        <span className="font-mono text-lg" title={session.session_id}>{shortSessionId(session.session_id)}</span>
      </PageTitle>
      <div className="mb-5" />

      <StatStrip
        items={[
          { label: 'Requests', value: session.request_count },
          turns && turns.length > 0 && { label: 'Turns', value: turns.length },
          {
            label: 'Wall / API time',
            value: `${formatDuration(session.wall_ms)} / ${formatDuration(session.api_ms)}`,
            title: `~${formatDuration(Math.max(0, modelToolTime))} in tools/user time`,
          },
          { label: 'Cache hit', value: formatRatio(session.cache_hit_ratio) },
          {
            label: 'Cache r/w',
            value: `${compactTokens(session.cache_read_tokens)} / ${compactTokens(session.cache_write_tokens)}`,
            title: `${session.cache_read_tokens.toLocaleString()} read / ${session.cache_write_tokens.toLocaleString()} written`,
          },
          {
            label: 'Output',
            value: compactTokens(session.output_tokens),
            title: `${session.output_tokens.toLocaleString()} output tokens`,
          },
          { label: 'Tool calls', value: session.tool_calls },
          { label: 'Total cost', value: `$${session.total_cost.toFixed(4)}` },
        ]}
      />

      {session.agent_entrypoint && (
        <p className="mb-4 text-[13px] text-ink-tertiary">
          Agent: <Badge>{session.agent_entrypoint}</Badge>
          {session.agent_version ? ` v${session.agent_version}` : ''} · Models:{' '}
          {by_model.map(m => `${stripModelSuffix(m.model)} (${m.count})`).join(', ')}
        </p>
      )}

      {insights && <InsightsPanel insights={insights} />}

      {toolEntries.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1">
          {toolEntries.map(([name, count]) => (
            <Badge variant="outline" key={name}>
              {name}{count > 1 ? ` ×${count}` : ''}
            </Badge>
          ))}
        </div>
      )}

      {turns && turns.length > 0 && (
        <>
          <div className="microlabel mb-2">Turns</div>
          <div className="mb-6">
            <TurnsTable turns={turns} sessionId={session.session_id} loaded />
          </div>
          <div className="microlabel mb-2">Requests</div>
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
