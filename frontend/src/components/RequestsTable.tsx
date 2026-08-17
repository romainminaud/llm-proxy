import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RequestRecord } from '../types'
import { countToolCalls, getToolNames, shortSessionId } from '../utils/toolCalls'

type SortKey = 'timestamp' | 'model' | 'non_cached_input' | 'cached_input' | 'cache_write' | 'output_tokens' | 'input_cost' | 'cached_cost' | 'output_cost' | 'total_cost' | 'duration_ms'
type SortDir = 'asc' | 'desc'

const getInputTokens = (request: RequestRecord) => (
  request.input_tokens
  ?? request.response_body?.usage?.prompt_tokens
  ?? request.response_body?.usage?.input_tokens
  ?? 0
)

const getOutputTokens = (request: RequestRecord) => (
  request.output_tokens
  ?? request.response_body?.usage?.completion_tokens
  ?? request.response_body?.usage?.output_tokens
  ?? 0
)

const getCachedTokens = (request: RequestRecord) => (
  request.cached_tokens
  ?? request.response_body?.usage?.prompt_tokens_details?.cached_tokens
  ?? request.response_body?.usage?.cache_read_input_tokens
  ?? 0
)

const getCacheWriteTokens = (request: RequestRecord) => (
  request.cache_write_tokens
  ?? request.response_body?.usage?.cache_creation_input_tokens
  ?? 0
)

// Non-terminal stop reasons worth flagging: the model wanted to continue
const isMidTurnStop = (stopReason: string) =>
  ['tool_use', 'tool_calls', 'function_call', 'max_tokens', 'length', 'MAX_TOKENS'].includes(stopReason)

type RequestsTableProps = {
  requests: RequestRecord[]
  onSelect: (request: RequestRecord) => void
  onReplay: (request: RequestRecord) => void
  onCompare: (request: RequestRecord) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  priceMultiplier: number
}

const stripModelSuffix = (model: string) => {
  return model.replace(/(-\d{8}|-\d{4}-\d{2}-\d{2})$/, '')
}

function RequestsTable({
  requests,
  onSelect,
  onReplay,
  onCompare,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  priceMultiplier
}: RequestsTableProps) {
  const selectAllRef = useRef<HTMLInputElement | null>(null)
  const allSelected = requests.length > 0 && requests.every(request => selectedIds.has(request.id))
  const someSelected = requests.some(request => selectedIds.has(request.id))
  const [sortKey, setSortKey] = useState<SortKey>('timestamp')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const getSortValue = (r: RequestRecord, key: SortKey): number | string => {
    switch (key) {
      case 'timestamp': return r.timestamp ?? ''
      case 'model': return r.model ?? ''
      case 'non_cached_input': return getNonCachedInputTokens(r)
      case 'cached_input': return getCachedTokens(r)
      case 'cache_write': return getCacheWriteTokens(r)
      case 'output_tokens': return getOutputTokens(r)
      case 'input_cost': return r.input_cost ?? 0
      case 'cached_cost': return r.cached_cost ?? 0
      case 'output_cost': return r.output_cost ?? 0
      case 'total_cost': return r.total_cost ?? 0
      case 'duration_ms': return r.duration_ms ?? 0
    }
  }

  const sortedRequests = [...requests].sort((a, b) => {
    const av = getSortValue(a, sortKey)
    const bv = getSortValue(b, sortKey)
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const SortTh = ({ label, col }: { label: string; col: SortKey }) => (
    <th className="sortable-th" onClick={() => handleSort(col)}>
      {label}
      <span className="sort-indicator">{sortKey === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}</span>
    </th>
  )

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = !allSelected && someSelected
    }
  }, [allSelected, someSelected])

  return (
    <div className="table-wrap">
      <table className="requests-table">
        <thead>
          <tr>
            <th className="select-col">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                aria-label="Select all rows"
              />
            </th>
            <SortTh label="Time" col="timestamp" />
            <SortTh label="Model" col="model" />
            <th>Session</th>
            <th>Tool Calls</th>
            <SortTh label="Non-Cached Input" col="non_cached_input" />
            <SortTh label="Cached Input" col="cached_input" />
            <SortTh label="Cache Write" col="cache_write" />
            <SortTh label="Output Tokens" col="output_tokens" />
            <SortTh label="Input Cost" col="input_cost" />
            <SortTh label="Cached Cost" col="cached_cost" />
            <SortTh label="Output Cost" col="output_cost" />
            <SortTh label="Total Cost" col="total_cost" />
            <SortTh label="Duration" col="duration_ms" />
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedRequests.map(request => (
            (() => {
              const toolCallEntries = countToolCalls(getToolNames(request))
              return (
                <tr
                  key={request.id}
                  className={`${request.error ? 'error-row ' : ''}${selectedIds.has(request.id) ? 'selected-row' : ''}`}
                >
              <td className="select-col">
                <input
                  type="checkbox"
                  checked={selectedIds.has(request.id)}
                  onChange={() => onToggleSelect(request.id)}
                  aria-label={`Select request ${request.id}`}
                />
              </td>
              <td>{new Date(request.timestamp).toLocaleString()}</td>
              <td>
                {request.model ? (
                  <span className="model-badge">{stripModelSuffix(request.model)}</span>
                ) : '-'}
                {request.replay_of && <span className="replay-icon" title="Replay of previous request">↻</span>}
                {request.stop_reason && isMidTurnStop(request.stop_reason) && (
                  <span className="stop-reason-badge" title={`stop_reason: ${request.stop_reason}`}>
                    {request.stop_reason}
                  </span>
                )}
              </td>
              <td>
                {request.session_id ? (
                  <Link
                    to={`/sessions/${encodeURIComponent(request.session_id)}`}
                    className="session-link"
                    title={request.session_id}
                  >
                    {shortSessionId(request.session_id)}
                  </Link>
                ) : (
                  <span className="muted">-</span>
                )}
              </td>
              <td className="tool-calls-cell">
                {toolCallEntries.length === 0 ? (
                  <span className="muted">-</span>
                ) : (
                  <div className="tool-call-list">
                    {toolCallEntries.map(([name, count]) => (
                      <span key={name} className="tool-call-badge">
                        {name}{count > 1 ? ` ×${count}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="tokens">
                {(() => {
                  const nonCachedTokens = getNonCachedInputTokens(request)
                  return nonCachedTokens > 0 ? nonCachedTokens.toLocaleString() : '-'
                })()}
              </td>
              <td className="tokens">
                {(() => {
                  const cachedTokens = getCachedTokens(request)
                  return cachedTokens > 0 ? cachedTokens.toLocaleString() : '-'
                })()}
              </td>
              <td className="tokens">
                {(() => {
                  const cacheWriteTokens = getCacheWriteTokens(request)
                  return cacheWriteTokens > 0 ? cacheWriteTokens.toLocaleString() : '-'
                })()}
              </td>
              <td className="tokens">
                {(() => {
                  const outputTokens = getOutputTokens(request)
                  return outputTokens > 0 ? outputTokens.toLocaleString() : '-'
                })()}
              </td>
              <td className="cost">${((request.input_cost || 0) * priceMultiplier).toFixed(4)}</td>
              <td className="cost cached">${((request.cached_cost || 0) * priceMultiplier).toFixed(4)}</td>
              <td className="cost">${((request.output_cost || 0) * priceMultiplier).toFixed(4)}</td>
              <td className="cost">${((request.total_cost || 0) * priceMultiplier).toFixed(4)}</td>
              <td className="duration">{request.duration_ms}ms</td>
              <td>
                <button onClick={() => onSelect(request)}>View</button>
                <button onClick={() => onReplay(request)}>Replay</button>
                <button onClick={() => onCompare(request)}>Compare</button>
                <button onClick={() => {
                  const data = { request: request.request_body, response: request.response_body }
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `request-${request.id}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}>JSON</button>
              </td>
            </tr>
              )
            })()
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default RequestsTable
const getNonCachedInputTokens = (request: RequestRecord) => {
  // Prefer the provider-aware split computed at ingest; the magnitude
  // heuristic below only covers rows saved before that column existed.
  if (typeof request.non_cached_input_tokens === 'number') return request.non_cached_input_tokens
  const inputTokens = getInputTokens(request)
  const cachedTokens = getCachedTokens(request)
  if (cachedTokens > inputTokens) return inputTokens
  return Math.max(0, inputTokens - cachedTokens)
}
