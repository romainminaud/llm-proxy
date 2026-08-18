import { useEffect, useRef, useState } from 'react'
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
import { cn } from '@/lib/utils'
import type { RequestRecord } from '../types'
import { countToolCalls, getToolNames, shortSessionId } from '../utils/toolCalls'
import { stripModelSuffix } from '../utils/format'

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

const getNonCachedInputTokens = (request: RequestRecord) => {
  // Prefer the provider-aware split computed at ingest; the magnitude
  // heuristic below only covers rows saved before that column existed.
  if (typeof request.non_cached_input_tokens === 'number') return request.non_cached_input_tokens
  const inputTokens = getInputTokens(request)
  const cachedTokens = getCachedTokens(request)
  if (cachedTokens > inputTokens) return inputTokens
  return Math.max(0, inputTokens - cachedTokens)
}

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

const tokens = (n: number) => (n > 0 ? n.toLocaleString() : '-')

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

  const SortTh = ({ label, col, numeric }: { label: string; col: SortKey; numeric?: boolean }) => (
    <TableHead
      className={cn('cursor-pointer select-none hover:text-ink', numeric && 'text-right')}
      onClick={() => handleSort(col)}
    >
      {label}
      <span className={cn('ml-0.5', sortKey === col ? 'text-accent' : 'text-ink-muted')}>
        {sortKey === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </TableHead>
  )

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = !allSelected && someSelected
    }
  }, [allSelected, someSelected])

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-8">
            <input
              ref={selectAllRef}
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={allSelected}
              onChange={onToggleSelectAll}
              aria-label="Select all rows"
            />
          </TableHead>
          <SortTh label="Time" col="timestamp" />
          <SortTh label="Model" col="model" />
          <TableHead>Session</TableHead>
          <TableHead>Tool calls</TableHead>
          <SortTh label="Input" col="non_cached_input" numeric />
          <SortTh label="Cached" col="cached_input" numeric />
          <SortTh label="Cache write" col="cache_write" numeric />
          <SortTh label="Output" col="output_tokens" numeric />
          <SortTh label="Input $" col="input_cost" numeric />
          <SortTh label="Cached $" col="cached_cost" numeric />
          <SortTh label="Output $" col="output_cost" numeric />
          <SortTh label="Total $" col="total_cost" numeric />
          <SortTh label="Duration" col="duration_ms" numeric />
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedRequests.map(request => {
          const toolCallEntries = countToolCalls(getToolNames(request))
          return (
            <TableRow
              key={request.id}
              data-state={request.error ? 'error' : undefined}
              className={cn(selectedIds.has(request.id) && 'bg-accent-muted hover:bg-accent-muted')}
            >
              <TableCell className="w-8">
                <input
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  checked={selectedIds.has(request.id)}
                  onChange={() => onToggleSelect(request.id)}
                  aria-label={`Select request ${request.id}`}
                />
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-ink-tertiary">
                {new Date(request.timestamp).toLocaleString()}
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1">
                  {request.model ? <Badge>{stripModelSuffix(request.model)}</Badge> : '-'}
                  {request.replay_of && (
                    <span className="text-ink-tertiary" title="Replay of previous request">↻</span>
                  )}
                  {request.stop_reason && isMidTurnStop(request.stop_reason) && (
                    <Badge variant="warning" title={`stop_reason: ${request.stop_reason}`}>
                      {request.stop_reason}
                    </Badge>
                  )}
                </span>
              </TableCell>
              <TableCell>
                {request.session_id ? (
                  <Link
                    to={`/sessions/${encodeURIComponent(request.session_id)}`}
                    className="font-mono text-xs text-accent hover:underline"
                    title={request.session_id}
                  >
                    {shortSessionId(request.session_id)}
                  </Link>
                ) : (
                  <span className="text-ink-muted">-</span>
                )}
              </TableCell>
              <TableCell className="max-w-56">
                {toolCallEntries.length === 0 ? (
                  <span className="text-ink-muted">-</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {toolCallEntries.map(([name, count]) => (
                      <Badge variant="outline" key={name}>
                        {name}{count > 1 ? ` ×${count}` : ''}
                      </Badge>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableNum>{tokens(getNonCachedInputTokens(request))}</TableNum>
              <TableNum>{tokens(getCachedTokens(request))}</TableNum>
              <TableNum>{tokens(getCacheWriteTokens(request))}</TableNum>
              <TableNum>{tokens(getOutputTokens(request))}</TableNum>
              <TableNum>${((request.input_cost || 0) * priceMultiplier).toFixed(4)}</TableNum>
              <TableNum className="text-ink-tertiary">${((request.cached_cost || 0) * priceMultiplier).toFixed(4)}</TableNum>
              <TableNum>${((request.output_cost || 0) * priceMultiplier).toFixed(4)}</TableNum>
              <TableNum className="font-medium text-ink">${((request.total_cost || 0) * priceMultiplier).toFixed(4)}</TableNum>
              <TableNum>{request.duration_ms}ms</TableNum>
              <TableCell className="whitespace-nowrap">
                <span className="inline-flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onSelect(request)}>View</Button>
                  <Button size="sm" variant="ghost" onClick={() => onReplay(request)}>Replay</Button>
                  <Button size="sm" variant="ghost" onClick={() => onCompare(request)}>Compare</Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    const data = { request: request.request_body, response: request.response_body }
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `request-${request.id}.json`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}>JSON</Button>
                </span>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export default RequestsTable
