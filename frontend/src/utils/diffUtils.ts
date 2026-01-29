export function formatDiff(value: number | null | undefined, isCost = false): string {
  if (value === undefined || value === null) return '—'
  const prefix = value > 0 ? '+' : ''
  if (isCost) {
    return `${prefix}$${value.toFixed(6)}`
  }
  return `${prefix}${Math.round(value).toLocaleString()}`
}

export function formatPercent(original: number | null | undefined, current: number | null | undefined): string {
  if (original === 0 || original === undefined || original === null) {
    if (current === 0 || current === undefined || current === null) return ''
    return '(new)'
  }
  const percent = ((current - original) / original) * 100
  const prefix = percent > 0 ? '+' : ''
  return `(${prefix}${percent.toFixed(1)}%)`
}

export function getDiffClass(value: number | null | undefined, invert = false): string {
  if (value === undefined || value === null) return ''
  const isPositive = invert ? value < 0 : value > 0
  return isPositive ? 'diff-positive' : 'diff-negative'
}
