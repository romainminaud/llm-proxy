import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import Controls from './components/Controls'
import ErrorBoundary from './components/ErrorBoundary'
import ReplayModal from './components/ReplayModal'
import RequestDetail from './components/RequestDetail'
import RequestsTable from './components/RequestsTable'
import StatsCards from './components/StatsCards'
import type { DisplayStats, RequestRecord, Stats } from './types'

const API_BASE = 'http://localhost:8090'
const AUTO_REFRESH_MS = 10000

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

const computeDisplayStats = (requests: RequestRecord[]): DisplayStats => {
  let totalCost = 0
  let totalInputTokens = 0
  let totalCachedTokens = 0
  let totalOutputTokens = 0
  let totalDurationMs = 0
  let totalInputCost = 0
  let totalCachedCost = 0
  let totalOutputCost = 0

  requests.forEach(request => {
    totalInputTokens += getInputTokens(request)
    totalCachedTokens += getCachedTokens(request)
    totalOutputTokens += getOutputTokens(request)
    totalDurationMs += request.duration_ms || 0

    const inputCost = request.input_cost || 0
    const cachedCost = request.cached_cost || 0
    const outputCost = request.output_cost || 0
    totalInputCost += inputCost
    totalCachedCost += cachedCost
    totalOutputCost += outputCost
    totalCost += request.total_cost ?? (inputCost + cachedCost + outputCost)
  })

  return {
    totalRequests: requests.length,
    totalCost,
    totalInputTokens,
    totalCachedTokens,
    totalOutputTokens,
    totalDurationMs,
    totalInputCost,
    totalCachedCost,
    totalOutputCost
  }
}

const csvEscape = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return ''
  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

function App() {
  const [requests, setRequests] = useState<RequestRecord[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [selectedRequest, setSelectedRequest] = useState<RequestRecord | null>(null)
  const [replayRequest, setReplayRequest] = useState<RequestRecord | null>(null)
  const [modelFilter, setModelFilter] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true)
  const [priceMultiplier, setPriceMultiplier] = useState(1)

  const loadData = useCallback(async () => {
    const [reqRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/api/requests${modelFilter ? `?model=${encodeURIComponent(modelFilter)}` : ''}`),
      fetch(`${API_BASE}/api/stats`)
    ])
    const requestData = await reqRes.json()
    const statsData = await statsRes.json()
    const nextRequests = requestData as RequestRecord[]
    setRequests(nextRequests)
    setStats(statsData as Stats)
    setSelectedIds(prev => {
      const allowedIds = new Set(nextRequests.map(request => request.id))
      const next = new Set<string>()
      prev.forEach(id => {
        if (allowedIds.has(id)) next.add(id)
      })
      return next
    })
  }, [modelFilter])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!autoRefreshEnabled) return
    const interval = window.setInterval(() => {
      loadData()
    }, AUTO_REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [autoRefreshEnabled, loadData])

  const clearAll = async () => {
    if (!window.confirm('Delete all requests?')) return
    await fetch(`${API_BASE}/api/requests`, { method: 'DELETE' })
    loadData()
  }

  const copyId = async (id: string) => {
    if (!id) return
    try {
      await navigator.clipboard.writeText(id)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(null), 1500)
    } catch (err) {
      window.prompt('Copy ID:', id)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const allSelected = requests.length > 0 && requests.every(request => prev.has(request.id))
      if (allSelected) return new Set()
      return new Set(requests.map(request => request.id))
    })
  }

  const selectedRequests = useMemo(
    () => requests.filter(request => selectedIds.has(request.id)),
    [requests, selectedIds]
  )

  const selectionStats = useMemo<DisplayStats | null>(() => {
    if (selectedIds.size === 0) return null
    return computeDisplayStats(selectedRequests)
  }, [selectedIds, selectedRequests])

  const baseStats = useMemo<DisplayStats>(() => computeDisplayStats(requests), [requests])
  const displayStats = selectionStats ?? (stats ? baseStats : null)

  const exportSelectedCsv = () => {
    if (selectedRequests.length === 0) return
    const headers = [
      'timestamp',
      'id',
      'model',
      'path',
      'input_tokens',
      'cached_tokens',
      'output_tokens',
      'input_cost',
      'cached_cost',
      'output_cost',
      'total_cost',
      'duration_ms',
      'replay_of'
    ]
    const rows = selectedRequests.map(request => {
      const timestamp = new Date(request.timestamp).toISOString()
      const cachedTokens = getCachedTokens(request)
      const inputCost = request.input_cost || 0
      const cachedCost = request.cached_cost || 0
      const outputCost = request.output_cost || 0
      const totalCost = request.total_cost ?? (inputCost + cachedCost + outputCost)
      return [
        timestamp,
        request.id,
        request.model || '',
        request.path || '',
        request.input_tokens ?? '',
        cachedTokens || '',
        request.output_tokens ?? '',
        inputCost,
        cachedCost,
        outputCost,
        totalCost,
        request.duration_ms ?? '',
        request.replay_of || ''
      ]
    })

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(csvEscape).join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `llm-proxy-usage-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  const exportSelectedStatsCsv = () => {
    if (selectedRequests.length === 0) return
    const stats = computeDisplayStats(selectedRequests)
    const rows = [
      ['selected_requests', stats.totalRequests],
      ['total_cost', stats.totalCost.toFixed(6)],
      ['input_tokens', stats.totalInputTokens],
      ['cached_tokens', stats.totalCachedTokens],
      ['output_tokens', stats.totalOutputTokens],
      ['total_duration_ms', stats.totalDurationMs],
      ['input_cost', stats.totalInputCost.toFixed(6)],
      ['cached_cost', stats.totalCachedCost.toFixed(6)],
      ['output_cost', stats.totalOutputCost.toFixed(6)]
    ]
    const csvContent = [
      'metric,value',
      ...rows.map(([metric, value]) => `${csvEscape(metric)},${csvEscape(value)}`)
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `llm-proxy-selected-stats-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  return (
    <ErrorBoundary>
      <div className="container">
        <h1>LLM Proxy Dashboard</h1>

      <StatsCards
        stats={displayStats}
        selectionCount={selectedIds.size}
        priceMultiplier={priceMultiplier}
      />

      <Controls
        modelFilter={modelFilter}
        stats={stats}
        onModelFilterChange={setModelFilter}
        onRefresh={loadData}
        onClearAll={clearAll}
        autoRefreshEnabled={autoRefreshEnabled}
        autoRefreshMs={AUTO_REFRESH_MS}
        onAutoRefreshChange={setAutoRefreshEnabled}
        selectedCount={selectedRequests.length}
        onExportSelected={exportSelectedCsv}
        onExportSelectedStats={exportSelectedStatsCsv}
        priceMultiplier={priceMultiplier}
        onPriceMultiplierChange={setPriceMultiplier}
      />

        <ErrorBoundary fallback={<div className="error-banner">Failed to load requests table</div>}>
      <RequestsTable
        requests={requests}
        onSelect={setSelectedRequest}
        onReplay={setReplayRequest}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        priceMultiplier={priceMultiplier}
      />
        </ErrorBoundary>

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

        {replayRequest && (
          <ErrorBoundary fallback={<div className="error-banner">Failed to render replay modal</div>}>
            <ReplayModal
              request={replayRequest}
              apiBase={API_BASE}
              onClose={() => setReplayRequest(null)}
              onSuccess={() => {
                setReplayRequest(null)
                loadData()
              }}
            />
          </ErrorBoundary>
        )}
      </div>
    </ErrorBoundary>
  )
}

export default App
