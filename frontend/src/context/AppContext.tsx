import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DisplayStats, RequestRecord, Stats } from '../types'
import { getToolNames } from '../utils/toolCalls'

// In production, use relative URLs (same origin). In development, use the proxy or explicit URL.
const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
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
  let totalNonCachedTokens = 0
  let totalCachedTokens = 0
  let totalCacheWriteTokens = 0
  let totalReasoningTokens = 0
  let totalOutputTokens = 0
  let totalDurationMs = 0
  let totalInputCost = 0
  let totalCachedCost = 0
  let totalCacheWriteCost = 0
  let totalOutputCost = 0

  requests.forEach(request => {
    totalInputTokens += getInputTokens(request)
    totalNonCachedTokens += request.non_cached_input_tokens ?? getInputTokens(request)
    totalCachedTokens += getCachedTokens(request)
    totalCacheWriteTokens += request.cache_write_tokens ?? 0
    totalReasoningTokens += request.reasoning_tokens ?? 0
    totalOutputTokens += getOutputTokens(request)
    totalDurationMs += request.duration_ms || 0

    const inputCost = request.input_cost || 0
    const cachedCost = request.cached_cost || 0
    const cacheWriteCost = request.cache_write_cost || 0
    const outputCost = request.output_cost || 0
    totalInputCost += inputCost
    totalCachedCost += cachedCost
    totalCacheWriteCost += cacheWriteCost
    totalOutputCost += outputCost
    totalCost += request.total_cost ?? (inputCost + cachedCost + cacheWriteCost + outputCost)
  })

  const contextTokens = totalNonCachedTokens + totalCachedTokens + totalCacheWriteTokens

  return {
    totalRequests: requests.length,
    totalCost,
    totalInputTokens,
    totalCachedTokens,
    totalCacheWriteTokens,
    totalReasoningTokens,
    totalOutputTokens,
    totalDurationMs,
    totalInputCost,
    totalCachedCost,
    totalCacheWriteCost,
    totalOutputCost,
    cacheHitRatio: contextTokens > 0 ? totalCachedTokens / contextTokens : null
  }
}

type AppContextType = {
  // Data
  requests: RequestRecord[]
  stats: Stats | null

  // Selection
  selectedIds: Set<string>
  selectedRequests: RequestRecord[]
  selectionStats: DisplayStats | null
  displayStats: DisplayStats | null

  // Filters
  modelFilter: string
  setModelFilter: (filter: string) => void
  providerFilter: string
  setProviderFilter: (filter: string) => void

  // Pagination
  page: number
  setPage: (page: number) => void
  pageSize: number
  totalCount: number

  // Settings
  autoRefreshEnabled: boolean
  setAutoRefreshEnabled: (enabled: boolean) => void
  priceMultiplier: number
  setPriceMultiplier: (multiplier: number) => void

  // Modal states
  showSettingsModal: boolean
  setShowSettingsModal: (show: boolean) => void
  replayRequest: RequestRecord | null
  setReplayRequest: (request: RequestRecord | null) => void

  // Actions
  loadData: () => Promise<void>
  clearAll: () => Promise<void>
  toggleSelect: (id: string) => void
  toggleSelectAll: () => void
  exportSelectedCsv: () => void
  exportSelectedStatsCsv: () => void

  // Constants
  apiBase: string
  autoRefreshMs: number
}

const AppContext = createContext<AppContextType | null>(null)

export function useAppContext() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider')
  }
  return context
}

const csvEscape = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return ''
  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

export function AppProvider({ children }: { children: ReactNode }) {
  const PAGE_SIZE = 100
  const [requests, setRequests] = useState<RequestRecord[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [modelFilter, setModelFilterState] = useState('')
  const [providerFilter, setProviderFilterState] = useState('')
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  // Changing a filter always returns to the first page
  const setModelFilter = useCallback((filter: string) => {
    setModelFilterState(filter)
    setPage(0)
  }, [])
  const setProviderFilter = useCallback((filter: string) => {
    setProviderFilterState(filter)
    setPage(0)
  }, [])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true)
  const [priceMultiplier, setPriceMultiplier] = useState(1)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [replayRequest, setReplayRequest] = useState<RequestRecord | null>(null)

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (modelFilter) params.set('model', modelFilter)
    if (providerFilter) params.set('provider', providerFilter)
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(page * PAGE_SIZE))
    const [reqRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/api/requests?${params.toString()}`),
      fetch(`${API_BASE}/api/stats`)
    ])
    const requestData = await reqRes.json()
    const statsData = await statsRes.json()
    const nextRequests = requestData as RequestRecord[]
    const headerTotal = Number(reqRes.headers.get('X-Total-Count'))
    setTotalCount(Number.isFinite(headerTotal) && headerTotal > 0 ? headerTotal : nextRequests.length)
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
  }, [modelFilter, providerFilter, page])

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
      'session_id',
      'model',
      'path',
      'input_tokens',
      'cached_tokens',
      'cache_write_tokens',
      'output_tokens',
      'reasoning_tokens',
      'input_cost',
      'cached_cost',
      'cache_write_cost',
      'output_cost',
      'total_cost',
      'duration_ms',
      'stop_reason',
      'replay_of',
      'tools_defined',
      'tool_calls_made',
      'tool_names_called'
    ]
    const rows = selectedRequests.map(request => {
      const timestamp = new Date(request.timestamp).toISOString()
      const cachedTokens = getCachedTokens(request)
      const inputCost = request.input_cost || 0
      const cachedCost = request.cached_cost || 0
      const cacheWriteCost = request.cache_write_cost || 0
      const outputCost = request.output_cost || 0
      const totalCost = request.total_cost ?? (inputCost + cachedCost + cacheWriteCost + outputCost)

      // Prefer stored columns; fall back to body parsing for pre-extraction rows
      const body = request.request_body as Record<string, unknown> | null
      const toolsDefined = request.tools_defined_count
        ?? (Array.isArray(body?.tools) ? (body.tools as unknown[]).length : '')
      const toolNames = getToolNames(request)
      const toolCallsMade = request.tool_calls_count ?? (toolNames.length > 0 ? toolNames.length : '')
      const toolNamesCalled = toolNames.join(';')

      return [
        timestamp,
        request.id,
        request.session_id ?? '',
        request.model || '',
        request.path || '',
        request.input_tokens ?? '',
        cachedTokens || '',
        request.cache_write_tokens ?? '',
        request.output_tokens ?? '',
        request.reasoning_tokens ?? '',
        inputCost,
        cachedCost,
        cacheWriteCost,
        outputCost,
        totalCost,
        request.duration_ms ?? '',
        request.stop_reason ?? '',
        request.replay_of || '',
        toolsDefined,
        toolCallsMade,
        toolNamesCalled
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
      ['cache_write_tokens', stats.totalCacheWriteTokens],
      ['reasoning_tokens', stats.totalReasoningTokens],
      ['output_tokens', stats.totalOutputTokens],
      ['cache_hit_ratio', stats.cacheHitRatio === null ? '' : stats.cacheHitRatio.toFixed(4)],
      ['total_duration_ms', stats.totalDurationMs],
      ['input_cost', stats.totalInputCost.toFixed(6)],
      ['cached_cost', stats.totalCachedCost.toFixed(6)],
      ['cache_write_cost', stats.totalCacheWriteCost.toFixed(6)],
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

  const value: AppContextType = {
    requests,
    stats,
    selectedIds,
    selectedRequests,
    selectionStats,
    displayStats,
    modelFilter,
    setModelFilter,
    providerFilter,
    setProviderFilter,
    page,
    setPage,
    pageSize: PAGE_SIZE,
    totalCount,
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    priceMultiplier,
    setPriceMultiplier,
    showSettingsModal,
    setShowSettingsModal,
    replayRequest,
    setReplayRequest,
    loadData,
    clearAll,
    toggleSelect,
    toggleSelectAll,
    exportSelectedCsv,
    exportSelectedStatsCsv,
    apiBase: API_BASE,
    autoRefreshMs: AUTO_REFRESH_MS,
  }

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  )
}
