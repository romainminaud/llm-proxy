import type { Stats } from '../types'

type ControlsProps = {
  modelFilter: string
  stats: Stats | null
  onModelFilterChange: (value: string) => void
  onRefresh: () => void
  onClearAll: () => void
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
  onRefresh,
  onClearAll,
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
    </div>
  )
}

export default Controls
