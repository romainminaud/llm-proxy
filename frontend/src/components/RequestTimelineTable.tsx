import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import type { SessionRequest, TurnSummary } from '../types'
import { formatDuration, formatTokens, stripModelSuffix } from '../utils/format'

// Pure-CSS horizontal bar, scaled against the largest value in its column
function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className="mini-bar-wrap" title={label}>
      <div className="mini-bar" style={{ width: `${width}%` }} />
      <span className="mini-bar-label">{label}</span>
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
    <div className="table-wrap">
      <table className="requests-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Time</th>
            <th>Model</th>
            <th>Context</th>
            <th>Δ Context</th>
            <th>Cache Read</th>
            <th>Cache Write</th>
            <th>Output</th>
            <th>Reasoning</th>
            <th>Tools</th>
            <th>Stop</th>
            <th>Cost</th>
            <th>Duration</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request, i) => {
            const previousTurnId = i > 0 ? requests[i - 1].turn_id : null
            const turn =
              request.turn_id && request.turn_id !== previousTurnId
                ? turnById.get(request.turn_id)
                : undefined
            return (
              <Fragment key={request.id}>
                {turn && (
                  <tr className="turn-header-row">
                    <td colSpan={14}>
                      {turnLinkBase ? (
                        <Link
                          to={`${turnLinkBase}/${encodeURIComponent(turn.turn_id)}`}
                          className="session-link turn-id"
                          title={turn.turn_id}
                        >
                          Turn {turn.turn_id}
                        </Link>
                      ) : (
                        <span className="turn-id" title={turn.turn_id}>Turn {turn.turn_id}</span>
                      )}
                      <span className="muted">
                        {' '}· {turn.request_count} req{turn.request_count === 1 ? '' : 's'}
                        {turn.error_count > 0 && ` (${turn.error_count}✗)`}
                        {' '}· {formatDuration(turn.wall_ms)} wall / {formatDuration(turn.api_ms)} api
                        {' '}· out {formatTokens(turn.output_tokens)}
                        {' '}· {turn.tool_calls} tools
                        {' '}· ${turn.total_cost.toFixed(4)}
                      </span>
                    </td>
                  </tr>
                )}
                <tr className={request.error ? 'error-row' : ''}>
                  <td className="tokens">{request.seq}</td>
                  <td>{new Date(request.timestamp).toLocaleTimeString()}</td>
                  <td>
                    {request.model
                      ? <span className="model-badge">{stripModelSuffix(request.model)}</span>
                      : <span className="muted">-</span>}
                  </td>
                  <td className="bar-cell">
                    <Bar
                      value={request.total_input_tokens ?? 0}
                      max={maxContext}
                      label={formatTokens(request.total_input_tokens)}
                    />
                  </td>
                  <td className="tokens">
                    {request.context_growth === null
                      ? <span className="muted">-</span>
                      : `${request.context_growth >= 0 ? '+' : ''}${request.context_growth.toLocaleString()}`}
                  </td>
                  <td className="tokens">{formatTokens(request.cached_tokens)}</td>
                  <td className="tokens">{formatTokens(request.cache_write_tokens)}</td>
                  <td className="tokens">{formatTokens(request.output_tokens)}</td>
                  <td className="tokens">{formatTokens(request.reasoning_tokens)}</td>
                  <td className="tool-calls-cell">
                    {request.tool_names && request.tool_names.length > 0 ? (
                      <div className="tool-call-list">
                        {request.tool_names.map((name, j) => (
                          <span key={`${name}-${j}`} className="tool-call-badge">{name}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td>
                    {request.stop_reason
                      ? <span className="stop-reason-badge">{request.stop_reason}</span>
                      : <span className="muted">-</span>}
                  </td>
                  <td className="bar-cell">
                    <Bar
                      value={request.total_cost ?? 0}
                      max={maxCost}
                      label={`$${(request.total_cost ?? 0).toFixed(4)}`}
                    />
                  </td>
                  <td className="duration">{request.duration_ms}ms</td>
                  <td><button onClick={() => onView(request.id)}>View</button></td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
