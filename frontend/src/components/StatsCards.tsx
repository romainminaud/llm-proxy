import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DisplayStats } from '../types'
import { formatRatio } from '../utils/toolCalls'

type StatsCardsProps = {
  stats: DisplayStats | null
  selectionCount?: number
  priceMultiplier?: number
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-mono text-lg font-semibold tabular-nums leading-6 text-ink" title={title}>
          {value}
        </div>
      </CardContent>
    </Card>
  )
}

function StatsCards({ stats, selectionCount = 0, priceMultiplier = 1 }: StatsCardsProps) {
  if (!stats) return null
  const isFiltered = selectionCount > 0
  const totalSeconds = Math.round(stats.totalDurationMs / 1000)
  const durationMinutes = Math.floor(totalSeconds / 60)
  const durationSeconds = totalSeconds % 60
  const money = (value: number) => `$${(value * priceMultiplier).toFixed(2)}`

  return (
    <>
      {isFiltered && (
        <div className="mb-2 text-[13px] text-ink-tertiary">
          Showing totals for {selectionCount} selected request{selectionCount === 1 ? '' : 's'}
        </div>
      )}
      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-2">
        <Stat label="Requests" value={stats.totalRequests.toLocaleString()} />
        <Stat label="Input" value={stats.totalInputTokens.toLocaleString()} />
        <Stat label="Cached" value={stats.totalCachedTokens.toLocaleString()} />
        <Stat label="Cache write" value={stats.totalCacheWriteTokens.toLocaleString()} />
        <Stat
          label="Cache hit"
          value={formatRatio(stats.cacheHitRatio)}
          title="cache reads / (input + cache reads + cache writes)"
        />
        <Stat label="Reasoning" value={stats.totalReasoningTokens.toLocaleString()} />
        <Stat label="Output" value={stats.totalOutputTokens.toLocaleString()} />
        <Stat label="Duration" value={`${durationMinutes}m ${durationSeconds}s`} />
        <Stat label="Total cost" value={money(stats.totalCost)} />
        <Stat label="Input $" value={money(stats.totalInputCost)} />
        <Stat label="Cached $" value={money(stats.totalCachedCost)} />
        <Stat label="Cache write $" value={money(stats.totalCacheWriteCost)} />
        <Stat label="Output $" value={money(stats.totalOutputCost)} />
      </div>
    </>
  )
}

export default StatsCards
