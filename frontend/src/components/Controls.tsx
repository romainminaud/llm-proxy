import type { Stats } from '../types'

type ControlsProps = {
  modelFilter: string
  stats: Stats | null
  onModelFilterChange: (value: string) => void
  providerFilter: string
  onProviderFilterChange: (value: string) => void
  page: number
  pageSize: number
  totalCount: number
  onPageChange: (page: number) => void
  onRefresh: () => void
  onClearAll: () => void
  onSettings: () => void
  autoRefreshEnabled: boolean
  autoRefreshMs: number
  onAutoRefreshChange: (enabled: boolean) => void
  selectedCount: number
  onExportSelected: () => void
  onExportSelectedStats: () => void
  priceMultiplier: number
  onPriceMultiplierChange: (value: number) => void
}

function Controls({
  modelFilter,
  stats,
  onModelFilterChange,
  providerFilter,
  onProviderFilterChange,
  page,
  pageSize,
  totalCount,
  onPageChange,
  onRefresh,
  onClearAll,
  onSettings,
  autoRefreshEnabled,
  autoRefreshMs,
  onAutoRefreshChange,
  selectedCount,
  onExportSelected,
  onExportSelectedStats,
  priceMultiplier,
  onPriceMultiplierChange
}: ControlsProps) {
  const refreshSeconds = Math.round(autoRefreshMs / 1000)
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))

  return (
    <div className="controls">
      <button onClick={onRefresh}>Refresh</button>
      <select value={modelFilter} onChange={e => onModelFilterChange(e.target.value)}>
        <option value="">All Models</option>
        {stats?.byModel.map(model => (
          <option key={model.model} value={model.model}>
            {model.model} ({model.count})
          </option>
        ))}
      </select>
      <select value={providerFilter} onChange={e => onProviderFilterChange(e.target.value)}>
        <option value="">All Providers</option>
        <option value="openai">openai</option>
        <option value="anthropic">anthropic</option>
        <option value="gemini">gemini</option>
      </select>
      <button className="danger" onClick={onClearAll}>Clear All</button>
      <button
        className="secondary"
        onClick={onExportSelected}
        disabled={selectedCount === 0}
      >
        Export CSV ({selectedCount})
      </button>
      <button
        className="secondary"
        onClick={onExportSelectedStats}
        disabled={selectedCount === 0}
      >
        Export Stats ({selectedCount})
      </button>
      <label className="control-number">
        <span>Multiplier</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={Number.isFinite(priceMultiplier) ? priceMultiplier : 1}
          onChange={e => {
            const next = Number(e.target.value)
            onPriceMultiplierChange(Number.isFinite(next) ? next : 1)
          }}
        />
      </label>
      <label className="control-toggle">
        <input
          type="checkbox"
          checked={autoRefreshEnabled}
          onChange={e => onAutoRefreshChange(e.target.checked)}
        />
        Auto refresh
        <span className="control-hint">{refreshSeconds}s</span>
      </label>
      <button className="secondary" onClick={onSettings}>Settings</button>
      <div className="pager">
        <button
          className="secondary"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          ‹ Prev
        </button>
        <span className="pager-info">
          {page + 1} / {pageCount}
        </span>
        <button
          className="secondary"
          disabled={page + 1 >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next ›
        </button>
      </div>
    </div>
  )
}

export default Controls
