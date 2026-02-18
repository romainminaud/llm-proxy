import { useEffect, useRef } from 'react'
import type { RequestRecord } from '../types'

type ToolCall = {
  id?: string
  name: string
}

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

const extractToolCalls = (responseBody: RequestRecord['response_body']): ToolCall[] => {
  if (!responseBody || typeof responseBody !== 'object') return []
  const body = responseBody as {
    choices?: Array<{ message?: { tool_calls?: Array<{ id?: string; function?: { name?: string } }> } }>
  }
  if (!Array.isArray(body.choices)) return []
  const calls: ToolCall[] = []
  body.choices.forEach(choice => {
    const toolCalls = choice.message?.tool_calls
    if (!Array.isArray(toolCalls)) return
    toolCalls.forEach(call => {
      const name = call.function?.name
      if (name) {
        calls.push({ id: call.id, name })
      }
    })
  })
  return calls
}

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
            <th>Time</th>
            <th>Model</th>
            <th>Tool Calls</th>
            <th>Non-Cached Input</th>
            <th>Cached Input</th>
            <th>Output Tokens</th>
            <th>Input Cost</th>
            <th>Cached Cost</th>
            <th>Output Cost</th>
            <th>Total Cost</th>
            <th>Duration</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.map(request => (
            (() => {
              const toolCalls = extractToolCalls(request.response_body)
              const toolCallCounts = new Map<string, number>()
              toolCalls.forEach(call => {
                toolCallCounts.set(call.name, (toolCallCounts.get(call.name) || 0) + 1)
              })
              const toolCallEntries = Array.from(toolCallCounts.entries())
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
  const inputTokens = getInputTokens(request)
  const cachedTokens = getCachedTokens(request)
  if (cachedTokens > inputTokens) return inputTokens
  return Math.max(0, inputTokens - cachedTokens)
}
