import { Fragment } from 'react'
import { Link } from 'react-router-dom'
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
import type { SessionRequest, TurnSummary } from '../types'
import { formatDuration, formatTokens, stripModelSuffix } from '../utils/format'

// Horizontal bar scaled against the largest value in its column
function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className="relative h-4 min-w-24 overflow-hidden rounded-sm bg-elevated" title={label}>
      <div className="h-full bg-accent/25" style={{ width: `${width}%` }} />
      <span className="absolute inset-y-0 left-1.5 flex items-center font-mono text-[11px] tabular-nums text-ink-secondary">
        {label}
      </span>
    </div>
  )
}

type Props = {
  requests: SessionRequest[]
  onView: (id: string) => void
  // When set, requests are visually grouped: the first request of each
  // turn-tagged run gets a rollup header row linking to the turn drill-down.
  turns?: TurnSummary[]
  // Base path for turn links, e.g. `/turns/<encoded session id>`
  turnLinkBase?: string
}

export default function RequestTimelineTable({ requests, onView, turns, turnLinkBase }: Props) {
  const maxContext = Math.max(...requests.map(r => r.total_input_tokens ?? 0), 1)
  const maxCost = Math.max(...requests.map(r => r.total_cost ?? 0), 0.000001)
  const turnById = new Map((turns ?? []).map(turn => [turn.turn_id, turn]))

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-right">#</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Context</TableHead>
          <TableHead className="text-right">Δ Context</TableHead>
          <TableHead className="text-right">Cache read</TableHead>
          <TableHead className="text-right">Cache write</TableHead>
          <TableHead className="text-right">Output</TableHead>
          <TableHead className="text-right">Reasoning</TableHead>
          <TableHead>Tools</TableHead>
          <TableHead>Stop</TableHead>
          <TableHead>Cost</TableHead>
          <TableHead className="text-right">Duration</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((request, i) => {
          const previousTurnId = i > 0 ? requests[i - 1].turn_id : null
          const turn =
            request.turn_id && request.turn_id !== previousTurnId
              ? turnById.get(request.turn_id)
              : undefined
          return (
            <Fragment key={request.id}>
              {turn && (
                <TableRow className="border-t border-line bg-elevated/70 hover:bg-elevated/70">
                  <TableCell colSpan={14} className="py-1.5">
                    {turnLinkBase ? (
                      <Link
                        to={`${turnLinkBase}/${encodeURIComponent(turn.turn_id)}`}
                        className="font-mono text-xs font-semibold text-accent hover:underline"
                        title={turn.turn_id}
                      >
                        Turn {turn.turn_number} · {turn.turn_id}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs font-semibold text-ink" title={turn.turn_id}>
                        Turn {turn.turn_number} · {turn.turn_id}
                      </span>
                    )}
                    <span className="ml-2 font-mono text-[11px] tabular-nums text-ink-tertiary">
                      ${turn.total_cost.toFixed(4)}
                      {' '}· {turn.request_count} req{turn.request_count === 1 ? '' : 's'}
                      {turn.error_count > 0 && ` (${turn.error_count}✗)`}
                      {' '}· {formatDuration(turn.wall_ms)} wall / {formatDuration(turn.api_ms)} api
                      {' '}· out {formatTokens(turn.output_tokens)}
                      {' '}· {turn.tool_calls} tools
                    </span>
                    {turn.turn_prompt && (
                      <span className="ml-2 text-xs text-ink-secondary" title={turn.turn_prompt}>
                        {turn.turn_prompt.length > 110
                          ? `${turn.turn_prompt.slice(0, 110)}…`
                          : turn.turn_prompt}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )}
              <TableRow data-state={request.error ? 'error' : undefined}>
                <TableNum className="text-ink-muted">{request.seq}</TableNum>
                <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-ink-tertiary">
                  {new Date(request.timestamp).toLocaleTimeString()}
                </TableCell>
                <TableCell>
                  {request.model
                    ? <Badge>{stripModelSuffix(request.model)}</Badge>
                    : <span className="text-ink-muted">-</span>}
                </TableCell>
                <TableCell className="w-36">
                  <Bar
                    value={request.total_input_tokens ?? 0}
                    max={maxContext}
                    label={formatTokens(request.total_input_tokens)}
                  />
                </TableCell>
                <TableNum>
                  {request.context_growth === null
                    ? <span className="text-ink-muted">-</span>
                    : `${request.context_growth >= 0 ? '+' : ''}${request.context_growth.toLocaleString()}`}
                </TableNum>
                <TableNum>{formatTokens(request.cached_tokens)}</TableNum>
                <TableNum>{formatTokens(request.cache_write_tokens)}</TableNum>
                <TableNum>{formatTokens(request.output_tokens)}</TableNum>
                <TableNum>{formatTokens(request.reasoning_tokens)}</TableNum>
                <TableCell className="max-w-52">
                  {request.tool_names && request.tool_names.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {request.tool_names.map((name, j) => (
                        <Badge variant="outline" key={`${name}-${j}`}>{name}</Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-ink-muted">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {request.stop_reason
                    ? <Badge variant="accent">{request.stop_reason}</Badge>
                    : <span className="text-ink-muted">-</span>}
                </TableCell>
                <TableCell className="w-28">
                  <Bar
                    value={request.total_cost ?? 0}
                    max={maxCost}
                    label={`$${(request.total_cost ?? 0).toFixed(4)}`}
                  />
                </TableCell>
                <TableNum>{request.duration_ms}ms</TableNum>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => onView(request.id)}>View</Button>
                </TableCell>
              </TableRow>
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}
