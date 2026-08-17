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
