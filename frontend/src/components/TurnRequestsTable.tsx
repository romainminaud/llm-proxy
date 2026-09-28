import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableNum,
  TableRow,
} from '@/components/ui/table'
import type { SessionRequest, ToolCallDetail } from '../types'
import { compactTokens, formatCost, formatDuration, friendlyModel } from '../utils/format'

/* The turn drill-down as a story: one row per model call, with an Activity
   column that reads like a log line — which files it read, which it patched,
   what it finally answered — plus the same anomaly flagging as the turns
   list (≥2× the turn's median → flagged). */

// Tool calls that change state get the louder badge; everything else is a read.
const MUTATION_TOOL = /write|edit|patch|create|delete|update|remove|rename|move|mkdir|\brm\b|exec|bash|shell|command/i

// Stops that mean "the model finished normally" (same set as TurnsTable)
const TERMINAL_STOPS = new Set(['end_turn', 'stop', 'STOP', 'stop_sequence', 'completed', 'end'])
// Stops that just mean "handing control to tools" — expected mid-turn, kept quiet
const TOOL_STOPS = new Set(['tool_use', 'tool_calls', 'function_call', 'MALFORMED_FUNCTION_CALL'])

const median = (values: number[]) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const flagRatio = (value: number, med: number | undefined, enabled: boolean) =>
  enabled && med !== undefined && med > 0 && value >= 2 * med ? value / med : null

function FlaggedNum({
  value,
  ratio,
  label,
}: { value: React.ReactNode; ratio: number | null; label: string }) {
  if (!ratio) return <>{value}</>
  return (
    <span className="text-warning" title={`${label}: ${ratio.toFixed(1)}× the median of this turn`}>
      {value} ↑
    </span>
  )
}

// Horizontal bar scaled against the largest value in its column
function Bar({ value, max, label, title }: { value: number; max: number; label: string; title?: string }) {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className="relative h-4 min-w-20 overflow-hidden rounded-sm bg-elevated" title={title ?? label}>
      <div className="h-full bg-accent/25" style={{ width: `${width}%` }} />
      <span className="absolute inset-y-0 left-1.5 flex items-center font-mono text-[11px] tabular-nums text-ink-secondary">
        {label}
      </span>
    </div>
  )
}

// One-line summary of what a request did, for timeline tooltips
function activitySummary(request: SessionRequest): string {
  if (request.error) return 'failed'
  const calls = request.tool_call_details
  if (calls && calls.length > 0) {
    return calls.map(c => c.detail ? `${c.name} ${c.detail}` : c.name).join(' · ')
  }
  if (request.tool_names && request.tool_names.length > 0) return request.tool_names.join(' · ')
  if (request.response_snippet) return `“${request.response_snippet.slice(0, 80)}”`
  return 'no tool calls'
}

// Timeline color: what kind of work the call did
function segmentClass(request: SessionRequest): string {
  if (request.error) return 'bg-danger/70'
  const names = request.tool_call_details?.map(c => c.name) ?? request.tool_names ?? []
  if (names.some(name => MUTATION_TOOL.test(name))) return 'bg-warning/70'
  if (names.length > 0) return 'bg-accent/60'
  return 'bg-success/60' // pure answer, no tools — usually the turn's conclusion
}

/* Waterfall strip: the turn's wall clock as one horizontal track. Each model
   call is a segment at its actual start offset with its actual API duration;
   the empty stretches between segments are tool execution / agent overhead.
   Big gaps get labeled so "where did the time go" is answerable at a glance. */
function TurnTimeline({ requests, onView }: { requests: SessionRequest[]; onView: (id: string) => void }) {
  // timestamp is recorded when the proxy saves the completed request, so a
  // call spans [timestamp - duration, timestamp]
  const spans = requests.map(request => {
    const end = new Date(request.timestamp).getTime()
    return { request, start: end - (request.duration_ms ?? 0), end }
  })
  const t0 = Math.min(...spans.map(s => s.start))
  const total = Math.max(...spans.map(s => s.end)) - t0
  if (!Number.isFinite(total) || total <= 0) return null

  const pct = (ms: number) => (ms / total) * 100
  const apiMs = spans.reduce((sum, s) => sum + (s.end - s.start), 0)
  const gapMs = Math.max(0, total - apiMs)

  // Gaps between consecutive calls, labeled when wide enough to fit text
  const gaps = spans.slice(1).map((span, i) => ({
    from: spans[i].end,
    to: span.start,
  })).filter(gap => gap.to > gap.from)

  const ticks = [0.25, 0.5, 0.75]

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-baseline justify-between font-mono text-[11px] tabular-nums text-ink-tertiary">
        <span className="font-sans text-xs font-medium text-ink-secondary">Timeline</span>
        <span title="Time inside model calls vs everything between them (tool execution, agent overhead)">
          <span className="inline-block h-2 w-2 rounded-sm bg-accent/60 align-middle" /> model {formatDuration(apiMs)}
          <span className="mx-1.5">·</span>
          <span className="inline-block h-2 w-2 rounded-sm bg-elevated align-middle" /> tools &amp; other {formatDuration(gapMs)}
        </span>
      </div>
      <div className="relative h-9 overflow-hidden rounded-md border border-line bg-elevated/60">
        {ticks.map(tick => (
          <div key={tick} className="absolute inset-y-0 border-l border-line-subtle" style={{ left: `${tick * 100}%` }} />
        ))}
        {gaps.map((gap, i) => {
          const width = pct(gap.to - gap.from)
          if (width < 4) return null
          return (
            <span
              key={`gap-${i}`}
              className="absolute top-1/2 -translate-y-1/2 text-center font-mono text-[10px] tabular-nums text-ink-muted"
              style={{ left: `${pct(gap.from - t0)}%`, width: `${width}%` }}
              title={`${formatDuration(gap.to - gap.from)} between calls (tool execution / agent overhead)`}
            >
              {formatDuration(gap.to - gap.from)}
            </span>
          )
        })}
        {spans.map(({ request, start, end }) => {
          const width = Math.max(pct(end - start), 0.5)
          return (
            <button
              key={request.id}
              type="button"
              className={`absolute inset-y-1 min-w-1 cursor-pointer rounded-sm ${segmentClass(request)} transition-opacity hover:opacity-80`}
              style={{ left: `${pct(start - t0)}%`, width: `${width}%` }}
              title={`#${request.seq} · ${new Date(request.timestamp).toLocaleTimeString()} · ${formatDuration(request.duration_ms ?? 0)} · ${formatCost(request.total_cost ?? 0)}\n${activitySummary(request)}`}
              onClick={() => onView(request.id)}
            >
              {width > 3 && (
                <span className="px-1 font-mono text-[10px] font-medium tabular-nums text-white/90">
                  {request.seq}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-ink-muted">
        <span>{new Date(t0).toLocaleTimeString()}</span>
        {ticks.map(tick => <span key={tick}>{formatDuration(total * tick)}</span>)}
        <span>{formatDuration(total)}</span>
      </div>
    </div>
  )
}

function ToolCallLine({ call }: { call: ToolCallDetail }) {
  const mutates = MUTATION_TOOL.test(call.name)
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Badge variant={mutates ? 'warning' : 'outline'}>{call.name}</Badge>
      {call.detail && (
        <span
          className="truncate font-mono text-[11px] text-ink-secondary"
          title={call.detail}
        >
          {call.detail}
        </span>
      )}
    </div>
  )
}

// The model's thinking before it acted — quiet, single line, full text on hover
function ReasoningLine({ text }: { text: string }) {
  return (
    <span className="truncate text-[11px] italic text-ink-muted" title={`Reasoning: ${text}`}>
      ✻ {text}
    </span>
  )
}

// What this model call did, at a glance: what it thought, the tool calls it
// made (with their arguments), and/or the text it answered with.
function ActivityCell({ request }: { request: SessionRequest }) {
  if (request.error) {
    return (
      <span className="text-xs text-danger" title={request.error}>
        {request.error.length > 120 ? `${request.error.slice(0, 120)}…` : request.error}
      </span>
    )
  }

  const reasoning = request.reasoning_snippet
  const calls = request.tool_call_details
  if (calls && calls.length > 0) {
    return (
      <div className="flex flex-col gap-0.5">
        {reasoning && <ReasoningLine text={reasoning} />}
        {calls.map((call, i) => <ToolCallLine key={i} call={call} />)}
        {request.response_snippet && (
          <span className="truncate text-xs italic text-ink-tertiary" title={request.response_snippet}>
            “{request.response_snippet}”
          </span>
        )}
      </div>
    )
  }

  if (request.response_snippet || reasoning) {
    return (
      <div className="flex flex-col gap-0.5">
        {reasoning && <ReasoningLine text={reasoning} />}
        {request.response_snippet && (
          <span className="text-xs text-ink-secondary" title={request.response_snippet}>
            “{request.response_snippet.length > 160
              ? `${request.response_snippet.slice(0, 160)}…`
              : request.response_snippet}”
          </span>
        )}
      </div>
    )
  }

  // Legacy rows without stored bodies: fall back to bare tool names
  if (request.tool_names && request.tool_names.length > 0) {
    return (
      <div className="flex flex-wrap gap-1">
        {request.tool_names.map((name, i) => (
          <Badge variant="outline" key={`${name}-${i}`}>{name}</Badge>
        ))}
      </div>
    )
  }

  return <span className="text-ink-muted">-</span>
}

function StopCell({ request }: { request: SessionRequest }) {
  if (request.error) return <Badge variant="danger">failed</Badge>
  const stop = request.stop_reason
  if (!stop) return <span className="text-ink-muted">-</span>
  if (TERMINAL_STOPS.has(stop)) return <Badge variant="success">{stop}</Badge>
  if (TOOL_STOPS.has(stop)) return <span className="font-mono text-[11px] text-ink-tertiary">{stop}</span>
  return <Badge variant="warning" title={`Unusual stop reason: ${stop}`}>{stop}</Badge>
}

export default function TurnRequestsTable({
  requests,
  onView,
}: {
  requests: SessionRequest[]
  onView: (id: string) => void
}) {
  const maxContext = Math.max(...requests.map(r => r.total_input_tokens ?? 0), 1)
  const maxCost = Math.max(...requests.map(r => r.total_cost ?? 0), 0.000001)

  // Only worth a model column when the turn actually mixes models
  const showModel = useMemo(
    () => new Set(requests.map(r => r.model).filter(Boolean)).size > 1,
    [requests]
  )

  // Anomaly baselines from this turn's own calls; below 4 rows a median is noise.
  const medians = useMemo(() => {
    if (requests.length < 4) return null
    return {
      cost: median(requests.map(r => r.total_cost ?? 0)),
      duration: median(requests.map(r => r.duration_ms ?? 0)),
      output: median(requests.map(r => r.output_tokens ?? 0)),
    }
  }, [requests])
  const enough = medians !== null

  return (
    <div>
      {requests.length > 1 && <TurnTimeline requests={requests} onView={onView} />}
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-right">#</TableHead>
          <TableHead>Time</TableHead>
          {showModel && <TableHead>Model</TableHead>}
          <TableHead className="min-w-64" title="Tool calls this model call made (with their key argument), or the text it answered with">
            Activity
          </TableHead>
          <TableHead title="How the model call ended — quiet for tool handoffs, flagged when unusual">Stop</TableHead>
          <TableHead title="Total input tokens sent (new + cache read)">Context</TableHead>
          <TableHead className="text-right" title="Context growth vs the previous call">Δ ctx</TableHead>
          <TableHead className="text-right" title="Cache read / cache write tokens">Cache r/w</TableHead>
          <TableHead className="text-right" title="Output tokens (reasoning share in the tooltip)">Output</TableHead>
          <TableHead>Cost</TableHead>
          <TableHead className="text-right" title="Time inside the model call">API time</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map(request => {
          const ratios = {
            cost: flagRatio(request.total_cost ?? 0, medians?.cost, enough),
            duration: flagRatio(request.duration_ms ?? 0, medians?.duration, enough),
            output: flagRatio(request.output_tokens ?? 0, medians?.output, enough),
          }
          const reasoning = request.reasoning_tokens ?? 0
          return (
            <TableRow key={request.id} data-state={request.error ? 'error' : undefined}>
              <TableNum className="text-ink-muted">{request.seq}</TableNum>
              <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-ink-tertiary">
                {new Date(request.timestamp).toLocaleTimeString()}
              </TableCell>
              {showModel && (
                <TableCell>
                  {request.model
                    ? <Badge title={request.model}>{friendlyModel(request.model)}</Badge>
                    : <span className="text-ink-muted">-</span>}
                </TableCell>
              )}
              <TableCell className="max-w-md">
                <ActivityCell request={request} />
              </TableCell>
              <TableCell><StopCell request={request} /></TableCell>
              <TableCell className="w-32">
                <Bar
                  value={request.total_input_tokens ?? 0}
                  max={maxContext}
                  label={compactTokens(request.total_input_tokens)}
                  title={`${(request.total_input_tokens ?? 0).toLocaleString()} input tokens sent`}
                />
              </TableCell>
              <TableNum title={request.context_growth === null ? undefined : `${request.context_growth.toLocaleString()} tokens vs the previous call`}>
                {request.context_growth === null
                  ? <span className="text-ink-muted">-</span>
                  : `${request.context_growth >= 0 ? '+' : '-'}${compactTokens(Math.abs(request.context_growth))}`}
              </TableNum>
              <TableNum
                title={`${(request.cached_tokens ?? 0).toLocaleString()} cache read / ${(request.cache_write_tokens ?? 0).toLocaleString()} cache write`}
              >
                {compactTokens(request.cached_tokens)}
                <span className="text-ink-muted"> / </span>
                {compactTokens(request.cache_write_tokens)}
              </TableNum>
              <TableNum
                title={reasoning > 0
                  ? `${(request.output_tokens ?? 0).toLocaleString()} output, of which ${reasoning.toLocaleString()} reasoning`
                  : `${(request.output_tokens ?? 0).toLocaleString()} output tokens`}
              >
                <FlaggedNum value={compactTokens(request.output_tokens)} ratio={ratios.output} label="Output" />
                {reasoning > 0 && (
                  <span className="ml-1 text-[11px] text-ink-muted">({compactTokens(reasoning)}r)</span>
                )}
              </TableNum>
              <TableCell className="w-24">
                <Bar
                  value={request.total_cost ?? 0}
                  max={maxCost}
                  label={`${formatCost(request.total_cost ?? 0)}${ratios.cost ? ' ↑' : ''}`}
                  title={ratios.cost
                    ? `$${(request.total_cost ?? 0).toFixed(4)} — ${ratios.cost.toFixed(1)}× the median call of this turn`
                    : `$${(request.total_cost ?? 0).toFixed(4)}`}
                />
              </TableCell>
              <TableNum>
                <FlaggedNum
                  value={formatDuration(request.duration_ms ?? 0)}
                  ratio={ratios.duration}
                  label="API time"
                />
              </TableNum>
              <TableCell>
                <Button size="sm" variant="ghost" onClick={() => onView(request.id)}>View</Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
    </div>
  )
}
