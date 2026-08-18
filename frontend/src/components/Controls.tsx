import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
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
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Button onClick={onRefresh}>
        <RefreshCw />
        Refresh
      </Button>
      <Select value={modelFilter} onChange={e => onModelFilterChange(e.target.value)}>
        <option value="">All models</option>
        {stats?.byModel.map(model => (
          <option key={model.model} value={model.model}>
            {model.model} ({model.count})
          </option>
        ))}
      </Select>
      <Select value={providerFilter} onChange={e => onProviderFilterChange(e.target.value)}>
        <option value="">All providers</option>
        <option value="openai">openai</option>
        <option value="anthropic">anthropic</option>
        <option value="gemini">gemini</option>
        <option value="openrouter">openrouter</option>
      </Select>
      <Button variant="destructive" onClick={onClearAll}>Clear all</Button>
      <Button variant="ghost" onClick={onExportSelected} disabled={selectedCount === 0}>
        Export CSV ({selectedCount})
      </Button>
      <Button variant="ghost" onClick={onExportSelectedStats} disabled={selectedCount === 0}>
        Export stats ({selectedCount})
      </Button>
      <label className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
        <span className="microlabel">Multiplier</span>
        <Input
          type="number"
          min="0"
          step="0.01"
          className="w-[72px] text-right font-mono tabular-nums"
          value={Number.isFinite(priceMultiplier) ? priceMultiplier : 1}
          onChange={e => {
            const next = Number(e.target.value)
            onPriceMultiplierChange(Number.isFinite(next) ? next : 1)
          }}
        />
      </label>
      <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-secondary">
        <input
          type="checkbox"
          className="accent-[var(--accent)]"
          checked={autoRefreshEnabled}
          onChange={e => onAutoRefreshChange(e.target.checked)}
        />
        Auto refresh
        <span className="microlabel">{refreshSeconds}s</span>
      </label>
      <Button variant="ghost" onClick={onSettings}>Settings</Button>
      <div className="ml-auto flex items-center gap-1.5">
        <Button size="sm" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          ‹ Prev
        </Button>
        <span className="px-1 font-mono text-xs tabular-nums text-ink-tertiary">
          {page + 1} / {pageCount}
        </span>
        <Button size="sm" disabled={page + 1 >= pageCount} onClick={() => onPageChange(page + 1)}>
          Next ›
        </Button>
      </div>
    </div>
  )
}

export default Controls
