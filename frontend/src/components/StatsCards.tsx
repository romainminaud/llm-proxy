import type { DisplayStats } from '../types'
import { formatRatio } from '../utils/toolCalls'

type StatsCardsProps = {
  stats: DisplayStats | null
  selectionCount?: number
  priceMultiplier?: number
}

function StatsCards({ stats, selectionCount = 0, priceMultiplier = 1 }: StatsCardsProps) {
  if (!stats) return null
  const isFiltered = selectionCount > 0
  const totalSeconds = Math.round(stats.totalDurationMs / 1000)
  const durationMinutes = Math.floor(totalSeconds / 60)
  const durationSeconds = totalSeconds % 60
  const applyMultiplier = (value: number) => value * priceMultiplier

  return (
    <>
      {isFiltered && (
        <div className="stats-note">
          Showing totals for {selectionCount} selected request{selectionCount === 1 ? '' : 's'}
        </div>
      )}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">{isFiltered ? 'Requests' : 'Requests'}</div>
          <div className="stat-value">{stats.totalRequests}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Input</div>
          <div className="stat-value">{stats.totalInputTokens.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cached</div>
          <div className="stat-value">{stats.totalCachedTokens.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cache Write</div>
          <div className="stat-value">{stats.totalCacheWriteTokens.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cache Hit</div>
          <div className="stat-value" title="cache reads / (input + cache reads + cache writes)">
            {formatRatio(stats.cacheHitRatio)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Reasoning</div>
          <div className="stat-value">{stats.totalReasoningTokens.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Output</div>
          <div className="stat-value">{stats.totalOutputTokens.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Duration</div>
          <div className="stat-value">{durationMinutes}m {durationSeconds}s</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Cost</div>
          <div className="stat-value cost">${applyMultiplier(stats.totalCost).toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Input $</div>
          <div className="stat-value cost">${applyMultiplier(stats.totalInputCost).toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cached $</div>
          <div className="stat-value cost">${applyMultiplier(stats.totalCachedCost).toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cache Write $</div>
          <div className="stat-value cost">${applyMultiplier(stats.totalCacheWriteCost).toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Output $</div>
          <div className="stat-value cost">${applyMultiplier(stats.totalOutputCost).toFixed(2)}</div>
        </div>
      </div>
    </>
  )
}

export default StatsCards
