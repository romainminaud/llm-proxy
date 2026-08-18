export const formatTokens = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toLocaleString()

export const formatDuration = (ms: number) => {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export const stripModelSuffix = (model: string) =>
  model.replace(/(-\d{8}|-\d{4}-\d{2}-\d{2})$/, '')

// $0.0667 → "$0.067", $0.3108 → "$0.31", $1.234 → "$1.23", $0 → "$0"
export const formatCost = (v: number) => {
  if (v === 0) return '$0'
  if (v >= 1) return `$${v.toFixed(2)}`
  return `$${Number(v.toPrecision(2))}`
}

// 497 → "497", 4674 → "4.7k", 85_012 → "85.0k"→"85k", 193_426 → "193k", 2_400_000 → "2.4M"
export const compactTokens = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  if (n < 1000) return String(n)
  const k = n / 1000
  if (k < 100) return `${k.toFixed(1).replace(/\.0$/, '')}k`
  if (k < 1000) return `${Math.round(k)}k`
  return `${(k / 1000).toFixed(1).replace(/\.0$/, '')}M`
}

// "claude-sonnet-4-5" → "Sonnet 4.5"; non-Claude ids pass through date-stripped
export const friendlyModel = (model: string) => {
  const stripped = stripModelSuffix(model)
  const claude = stripped.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?$/)
  if (claude) {
    const name = claude[1][0].toUpperCase() + claude[1].slice(1)
    return `${name} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`
  }
  return stripped
}

// "Today, 10:15" / "Yesterday, 18:02" / "Aug 12, 09:30"
export const formatWhen = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

// 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd"
export const ordinal = (n: number) => {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
  return `${n}${suffix}`
}
