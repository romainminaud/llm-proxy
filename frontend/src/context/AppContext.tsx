import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DisplayStats, RequestRecord, Stats } from '../types'

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
  const [requests, setRequests] = useState<RequestRecord[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [modelFilter, setModelFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true)
  const [priceMultiplier, setPriceMultiplier] = useState(1)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [replayRequest, setReplayRequest] = useState<RequestRecord | null>(null)

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
      const outputCost = request.output_cost || 0
      const totalCost = request.total_cost ?? (inputCost + cachedCost + outputCost)

      const body = request.request_body as Record<string, unknown> | null
      const toolsDefined = Array.isArray(body?.tools) ? (body.tools as unknown[]).length : ''

      const resp = request.response_body as Record<string, unknown> | null
      // OpenAI: choices[0].message.tool_calls
      const openaiToolCalls = (resp?.choices as Array<Record<string, unknown>> | undefined)?.[0]
        ?.message as Record<string, unknown> | undefined
      const openaiCalls = Array.isArray(openaiToolCalls?.tool_calls)
        ? (openaiToolCalls!.tool_calls as Array<Record<string, unknown>>)
        : null
      // Anthropic: content[].type === 'tool_use'
      const anthropicCalls = Array.isArray(resp?.content)
        ? (resp!.content as Array<Record<string, unknown>>).filter(c => c.type === 'tool_use')
        : null

      const toolCallItems = openaiCalls ?? anthropicCalls ?? []
      const toolCallsMade = toolCallItems.length > 0 ? toolCallItems.length : ''
      const toolNamesCalled = toolCallItems.length > 0
        ? toolCallItems.map(c => (c.function as Record<string, unknown>)?.name ?? c.name ?? '').join(';')
        : ''

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

  const value: AppContextType = {
    requests,
    stats,
    selectedIds,
    selectedRequests,
    selectionStats,
    displayStats,
    modelFilter,
    setModelFilter,
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
