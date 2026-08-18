import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import type { TurnSummary } from '../types'
import { shortSessionId } from '../utils/toolCalls'
import {
  compactTokens,
  formatCost,
  formatDuration,
  formatWhen,
  friendlyModel,
  ordinal,
} from '../utils/format'

/* Turns as a debugging surface: a compact scan row (prompt → status → cost →
   time → volume), anomalies flagged against the table's own medians, and the
   full observability detail behind row expansion. */

type TurnRow = TurnSummary & { session_id?: string | null }

type Props = {
  turns: TurnRow[]
  // Set when rows can come from different sessions (cross-session list):
  // shows a "When" column and a session link in the expanded panel.
  showSession?: boolean
  // Session id shared by all rows (session detail page).
  sessionId?: string
  loaded?: boolean
  emptyMessage?: React.ReactNode
}

// Stops that mean "the model finished normally"; anything else is surfaced.
const TERMINAL_STOPS = new Set(['end_turn', 'stop', 'STOP', 'stop_sequence', 'completed', 'end'])

const median = (values: number[]) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const contextOf = (turn: TurnRow) => turn.input_tokens + turn.cache_read_tokens

type Medians = { cost: number; wall: number; calls: number; context: number } | null

// ≥2× the table median (with enough rows to make a median meaningful) → flagged
const flagRatio = (value: number, med: number | undefined, enabled: boolean) =>
  enabled && med !== undefined && med > 0 && value >= 2 * med ? value / med : null

function FlaggedNum({
  value,
  ratio,
  label,
}: { value: React.ReactNode; ratio: number | null; label: string }) {
  if (!ratio) return <>{value}</>
  return (
    <span className="text-warning" title={`${label}: ${ratio.toFixed(1)}× the median of this table`}>
      {value} ↑
    </span>
  )
}

function StatusBadge({ turn }: { turn: TurnRow }) {
  if (turn.error_count > 0) {
    return <Badge variant="danger" title={`${turn.error_count} failed request${turn.error_count === 1 ? '' : 's'}`}>Failed</Badge>
  }
  if (turn.last_stop_reason && !TERMINAL_STOPS.has(turn.last_stop_reason)) {
    return (
      <Badge variant="warning" title={`Turn ended on stop_reason "${turn.last_stop_reason}" instead of a normal stop`}>
        {turn.last_stop_reason}
      </Badge>
    )
  }
  return <Badge variant="success">Done</Badge>
}

function TokenLine({ label, value, indent }: { label: string; value: number; indent?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-6', indent && 'pl-4')}>
      <span className="text-ink-tertiary">{indent ? `↳ ${label}` : label}</span>
      <span className="font-mono tabular-nums text-ink">{value.toLocaleString()}</span>
    </div>
  )
}

function ExpandedPanel({ turn, sid, issues }: { turn: TurnRow; sid: string | null; issues: string[] }) {
  const context = contextOf(turn)
  return (
    <div className="grid gap-x-10 gap-y-4 px-1 py-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
      <div className="flex flex-col gap-1">
        <div className="microlabel mb-1">Turn</div>
        <div className="flex justify-between gap-6">
          <span className="text-ink-tertiary">ID</span>
          <span className="select-all font-mono text-ink" title={turn.turn_id}>{turn.turn_id}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-ink-tertiary">Position</span>
          <span className="text-ink">{ordinal(turn.turn_number)} turn of the session</span>
        </div>
        {sid && (
          <div className="flex justify-between gap-6">
            <span className="text-ink-tertiary">Session</span>
            <Link
              to={`/sessions/${encodeURIComponent(sid)}`}
              className="font-mono text-accent hover:underline"
              title={sid}
            >
              {shortSessionId(sid)}
            </Link>
          </div>
        )}
        <div className="flex justify-between gap-6">
          <span className="text-ink-tertiary">Started</span>
          <span className="text-ink" title={new Date(turn.started_at).toLocaleString()}>
            {formatWhen(turn.started_at)}
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-ink-tertiary">Duration</span>
          <span className="font-mono tabular-nums text-ink" title="wall clock / time inside model calls">
            {formatDuration(turn.wall_ms)} wall / {formatDuration(turn.api_ms)} API
          </span>
        </div>
        {turn.last_stop_reason && (
          <div className="flex justify-between gap-6">
            <span className="text-ink-tertiary">Last stop</span>
            <span className="font-mono text-ink">{turn.last_stop_reason}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="microlabel mb-1">Tokens</div>
        <TokenLine label="Context processed" value={context} />
        <TokenLine label="New input" value={turn.input_tokens} indent />
        <TokenLine label="Cache read" value={turn.cache_read_tokens} indent />
        <TokenLine label="Cache write" value={turn.cache_write_tokens} />
        <TokenLine label="Output" value={turn.output_tokens} />
        {turn.reasoning_tokens > 0 && <TokenLine label="Reasoning" value={turn.reasoning_tokens} />}
      </div>

      <div className="flex flex-col gap-1">
        <div className="microlabel mb-1">Cost by model</div>
        {turn.by_model.map(m => (
          <div key={m.model} className="flex justify-between gap-6">
            <span className="text-ink-tertiary" title={m.model}>
              {friendlyModel(m.model)} <span className="text-ink-muted">× {m.count}</span>
            </span>
            <span className="font-mono tabular-nums text-ink">{formatCost(m.total_cost)}</span>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-6 border-t border-line-subtle pt-1">
          <span className="text-ink-secondary">Total</span>
          <span className="font-mono font-medium tabular-nums text-ink">{formatCost(turn.total_cost)}</span>
        </div>
        {issues.length > 0 && (
          <div className="mt-2 text-warning">⚠ {issues.join(' · ')}</div>
        )}
        {sid && (
          <Link
            to={`/turns/${encodeURIComponent(sid)}/${encodeURIComponent(turn.turn_id)}`}
            className="mt-2 font-medium text-accent hover:underline"
          >
            Open turn: request-by-request timeline →
          </Link>
        )}
      </div>
    </div>
  )
}

export default function TurnsTable({ turns, showSession, sessionId, loaded, emptyMessage }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const columnCount = showSession ? 11 : 10

  // Anomaly baselines from the rows on screen; below 4 turns a median is noise.
  const medians: Medians = useMemo(() => {
    if (turns.length < 4) return null
    return {
      cost: median(turns.map(t => t.total_cost)),
      wall: median(turns.map(t => t.wall_ms)),
      calls: median(turns.map(t => t.request_count)),
      context: median(turns.map(contextOf)),
    }
  }, [turns])

  const summary = useMemo(() => {
    if (turns.length === 0) return null
    return {
      count: turns.length,
      total: turns.reduce((sum, t) => sum + t.total_cost, 0),
      medianCost: median(turns.map(t => t.total_cost)),
      failed: turns.filter(t => t.error_count > 0).length,
      medianWall: median(turns.map(t => t.wall_ms)),
      medianCalls: median(turns.map(t => t.request_count)),
    }
  }, [turns])

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div>
      {summary && (
        <div className="mb-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-xs tabular-nums text-ink-tertiary">
          <span><span className="font-medium text-ink">{summary.count}</span> turns</span>
          <span>·</span>
          <span><span className="font-medium text-ink">{formatCost(summary.total)}</span> total</span>
          <span>·</span>
          <span>{formatCost(summary.medianCost)} median</span>
          <span>·</span>
          <span className={cn(summary.failed > 0 && 'font-medium text-danger')}>
            {summary.failed} failed
          </span>
          <span>·</span>
          <span>{formatDuration(summary.medianWall)} median</span>
          <span>·</span>
          <span>{Math.round(summary.medianCalls)} calls/turn</span>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Prompt</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead className="text-right" title="API requests to the model. Each tool execution needs a follow-up call with the result, so a healthy agent turn shows tools + 1.">LLM calls</TableHead>
            <TableHead className="text-right" title="new input + cache read tokens, summed across the turn's calls (each call re-sends the conversation)">Context</TableHead>
            <TableHead className="text-right" title="output tokens">Output</TableHead>
            <TableHead className="text-right" title="tool calls the model made across the turn">Tools</TableHead>
            <TableHead>Model</TableHead>
            {showSession && <TableHead>When</TableHead>}
            <TableHead className="w-8"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {turns.map(turn => {
            const sid = turn.session_id ?? sessionId ?? null
            const key = `${sid ?? ''}:${turn.turn_id}`
            const isOpen = expanded.has(key)
            const context = contextOf(turn)
            const enough = medians !== null
            const ratios = {
              cost: flagRatio(turn.total_cost, medians?.cost, enough),
              wall: flagRatio(turn.wall_ms, medians?.wall, enough),
              calls: flagRatio(turn.request_count, medians?.calls, enough),
              context: flagRatio(context, medians?.context, enough),
            }
            const issues = [
              ratios.cost && `High cost (${ratios.cost.toFixed(1)}× median)`,
              ratios.wall && `Slow (${ratios.wall.toFixed(1)}× median)`,
              ratios.calls && `High call count (${ratios.calls.toFixed(1)}× median)`,
              ratios.context && `High context (${ratios.context.toFixed(1)}× median)`,
            ].filter((issue): issue is string => Boolean(issue))
            const primaryModel = turn.by_model[0]

            return (
              <Fragment key={key}>
                <TableRow
                  data-state={turn.error_count > 0 ? 'error' : undefined}
                  className="cursor-pointer"
                  onClick={() => toggle(key)}
                >
                  <TableCell className="min-w-72 max-w-xl">
                    <span className="mr-1.5 font-mono text-[11px] tabular-nums text-ink-muted">
                      #{turn.turn_number}
                    </span>
                    {turn.turn_prompt
                      ? <span className="text-ink" title={turn.turn_prompt}>
                          {turn.turn_prompt.length > 140 ? `${turn.turn_prompt.slice(0, 140)}…` : turn.turn_prompt}
                        </span>
                      : <span className="font-mono text-xs text-ink-tertiary" title={turn.turn_id}>{turn.turn_id}</span>}
                  </TableCell>
                  <TableCell><StatusBadge turn={turn} /></TableCell>
                  <TableNum className="font-medium text-ink">
                    <FlaggedNum value={formatCost(turn.total_cost)} ratio={ratios.cost} label="Cost" />
                  </TableNum>
                  <TableNum title={`${formatDuration(turn.api_ms)} inside model calls`}>
                    <FlaggedNum value={formatDuration(turn.wall_ms)} ratio={ratios.wall} label="Duration" />
                  </TableNum>
                  <TableNum>
                    <FlaggedNum value={turn.request_count} ratio={ratios.calls} label="LLM calls" />
                  </TableNum>
                  <TableNum title={`${turn.input_tokens.toLocaleString()} new input + ${turn.cache_read_tokens.toLocaleString()} cache read`}>
                    <FlaggedNum value={compactTokens(context)} ratio={ratios.context} label="Context" />
                  </TableNum>
                  <TableNum>{compactTokens(turn.output_tokens)}</TableNum>
                  <TableNum>{turn.tool_calls}</TableNum>
                  <TableCell>
                    {primaryModel ? (
                      <span className="whitespace-nowrap">
                        <Badge title={primaryModel.model}>{friendlyModel(primaryModel.model)}</Badge>
                        {turn.by_model.length > 1 && (
                          <span
                            className="ml-1 text-[11px] text-ink-muted"
                            title={turn.by_model.slice(1).map(m => friendlyModel(m.model)).join(', ')}
                          >
                            +{turn.by_model.length - 1}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-ink-muted">-</span>
                    )}
                  </TableCell>
                  {showSession && (
                    <TableCell
                      className="whitespace-nowrap text-xs text-ink-tertiary"
                      title={new Date(turn.started_at).toLocaleString()}
                    >
                      {formatWhen(turn.started_at)}
                    </TableCell>
                  )}
                  <TableCell className="w-8">
                    <ChevronRight
                      size={14}
                      className={cn('text-ink-muted transition-transform', isOpen && 'rotate-90')}
                    />
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="bg-elevated/50 hover:bg-elevated/50">
                    <TableCell colSpan={columnCount}>
                      <ExpandedPanel turn={turn} sid={sid} issues={issues} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
          {loaded && turns.length === 0 && (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-8 text-center text-ink-muted">
                {emptyMessage ?? 'No turns yet.'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
