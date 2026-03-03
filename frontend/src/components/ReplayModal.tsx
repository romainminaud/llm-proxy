import { useState, useEffect } from 'react'
import { formatDiff, formatPercent, getDiffClass } from '../utils/diffUtils'
import { getApiKey, updateApiKey } from '../utils/apiKeys'
import type { ProviderInfo, ReplayComparisonSummary, RequestRecord } from '../types'

type ReplayModalProps = {
  request: RequestRecord
  apiBase: string
  onClose: () => void
  onSuccess: () => void
}

const DEFAULT_PROVIDER_INFO: ProviderInfo = {
  name: 'unknown',
  replayApiKeyHeader: 'x-api-key',
  replayApiKeyPlaceholder: 'sk-...',
}

function extractModel(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const model = (value as { model?: unknown }).model
  return typeof model === 'string' ? model : ''
}

function ReplayModal({ request, apiBase, onClose, onSuccess }: ReplayModalProps) {
  const provider = request.provider || 'openai'
  const [requestBody, setRequestBody] = useState(() => JSON.stringify(request.request_body, null, 2))
  const [apiKey, setApiKey] = useState(() => getApiKey(provider) || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comparison, setComparison] = useState<ReplayComparisonSummary | null>(null)
  const [providerInfo, setProviderInfo] = useState<ProviderInfo>(DEFAULT_PROVIDER_INFO)
  const [modelOverride, setModelOverride] = useState(() => extractModel(request.request_body) || request.model || '')
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [thinkingBudget, setThinkingBudget] = useState<string>('')
  const isAnthropic = provider === 'anthropic'

  // Keep request body textarea in sync with override fields
  useEffect(() => {
    try {
      const body = JSON.parse(JSON.stringify(request.request_body)) as Record<string, unknown>
      if (modelOverride && body.model !== modelOverride) {
        body.model = modelOverride
      }
      if (isAnthropic && thinkingBudget !== '') {
        const budget = parseInt(thinkingBudget, 10)
        if (!isNaN(budget) && budget >= 0) {
          if (budget === 0) {
            delete body.thinking
          } else {
            body.thinking = { type: 'enabled', budget_tokens: budget }
            body.temperature = 1
          }
        }
      }
      setRequestBody(JSON.stringify(body, null, 2))
    } catch {
      // leave textarea as-is if request_body isn't parseable
    }
  }, [modelOverride, thinkingBudget])

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const res = await fetch(`${apiBase}/api/providers`)
        if (res.ok) {
          const providers = await res.json() as Record<string, ProviderInfo>
          const provider = request.provider || 'openai'
          if (providers[provider]) {
            setProviderInfo(providers[provider])
          }
        }
      } catch {
        // Use default if fetch fails
      }
    }
    fetchProviders()
  }, [apiBase, request.provider])

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch(`${apiBase}/api/stats`)
        if (!res.ok) return
        const data = await res.json() as { byModel?: { model?: string }[] }
        const models = (data.byModel || [])
          .map(entry => entry.model)
          .filter((model): model is string => typeof model === 'string' && model.length > 0)
        const unique = Array.from(new Set(models))
        if (unique.length) {
          setModelOptions(unique.sort())
        }
      } catch {
        // ignore stats fetch errors
      }
    }
    fetchModels()
  }, [apiBase])

  const handleReplay = async () => {
    if (!apiKey) {
      setError('API key is required')
      return
    }

    let parsedBody: unknown
    try {
      parsedBody = JSON.parse(requestBody)
    } catch {
      setError('Invalid JSON in request body')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        [providerInfo.replayApiKeyHeader]: apiKey,
      }

      const res = await fetch(`${apiBase}/api/replay/${request.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(parsedBody),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Replay failed')
      }
      setComparison(data.comparison as ReplayComparisonSummary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replay failed')
    } finally {
      setLoading(false)
    }
  }

  const providerLabel = providerInfo.name.charAt(0).toUpperCase() + providerInfo.name.slice(1)

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Replay Request</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="replay-content">
          <div className="replay-form">
            <div className="form-group">
              <label>{providerLabel} API Key:</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => {
                  setApiKey(e.target.value)
                  updateApiKey(provider, e.target.value)
                }}
                placeholder={providerInfo.replayApiKeyPlaceholder}
              />
              <span className="form-hint">Key is saved locally in your browser</span>
            </div>

            <div className="form-group">
              <label>Model override (optional):</label>
              <input
                type="text"
                list="replay-model-options"
                value={modelOverride}
                onChange={e => setModelOverride(e.target.value)}
                placeholder={request.model || ''}
              />
              {modelOptions.length > 0 && (
                <datalist id="replay-model-options">
                  {modelOptions.map(model => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              )}
            </div>

            {isAnthropic && (
              <div className="form-group">
                <label>Thinking budget (tokens, optional):</label>
                <input
                  type="number"
                  min="0"
                  value={thinkingBudget}
                  onChange={e => setThinkingBudget(e.target.value)}
                  placeholder="e.g. 10000 — leave blank to keep original"
                />
                <span className="form-hint">Set to 0 to disable thinking. When enabled, temperature is forced to 1.</span>
              </div>
            )}

            <div className="form-group">
              <label>Request Body (editable):</label>
              <textarea
                className="request-body-editor"
                value={requestBody}
                onChange={e => setRequestBody(e.target.value)}
                rows={20}
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="replay-actions">
              <button onClick={handleReplay} disabled={loading}>
                {loading ? 'Replaying...' : 'Replay Request'}
              </button>
              {comparison && (
                <button onClick={onSuccess}>Done</button>
              )}
            </div>
          </div>

          {comparison && (
            <div className="comparison-section">
              <h4>Comparison: Original vs Replay</h4>
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Original</th>
                    <th>Replay</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="section-header-row">
                    <td colSpan={4}>Tokens</td>
                  </tr>
                  <tr>
                    <td>Input Tokens</td>
                    <td>{comparison.original.inputTokens.toLocaleString()}</td>
                    <td>{comparison.replay.inputTokens.toLocaleString()}</td>
                    <td className={getDiffClass(comparison.diff.inputTokens)}>
                      {formatDiff(comparison.diff.inputTokens)}
                      <span className="diff-percent">{formatPercent(comparison.original.inputTokens, comparison.replay.inputTokens)}</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Cached Tokens</td>
                    <td>{comparison.original.cacheReadTokens.toLocaleString()}</td>
                    <td>{comparison.replay.cacheReadTokens.toLocaleString()}</td>
                    <td className={getDiffClass(comparison.diff.cacheReadTokens, true)}>
                      {formatDiff(comparison.diff.cacheReadTokens)}
                      <span className="diff-percent">{formatPercent(comparison.original.cacheReadTokens, comparison.replay.cacheReadTokens)}</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Output Tokens</td>
                    <td>{comparison.original.outputTokens.toLocaleString()}</td>
                    <td>{comparison.replay.outputTokens.toLocaleString()}</td>
                    <td className={getDiffClass(comparison.diff.outputTokens)}>
                      {formatDiff(comparison.diff.outputTokens)}
                      <span className="diff-percent">{formatPercent(comparison.original.outputTokens, comparison.replay.outputTokens)}</span>
                    </td>
                  </tr>
                  <tr className="section-header-row">
                    <td colSpan={4}>Cost Breakdown</td>
                  </tr>
                  <tr>
                    <td>Non-Cached Input Cost</td>
                    <td>${(comparison.original.inputCost || 0).toFixed(6)}</td>
                    <td>${(comparison.replay.inputCost || 0).toFixed(6)}</td>
                    <td className={getDiffClass((comparison.replay.inputCost || 0) - (comparison.original.inputCost || 0))}>
                      {formatDiff((comparison.replay.inputCost || 0) - (comparison.original.inputCost || 0), true)}
                      <span className="diff-percent">{formatPercent(comparison.original.inputCost, comparison.replay.inputCost)}</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Cached Input Cost</td>
                    <td className="cached">${(comparison.original.cachedCost || 0).toFixed(6)}</td>
                    <td className="cached">${(comparison.replay.cachedCost || 0).toFixed(6)}</td>
                    <td className={getDiffClass((comparison.replay.cachedCost || 0) - (comparison.original.cachedCost || 0))}>
                      {formatDiff((comparison.replay.cachedCost || 0) - (comparison.original.cachedCost || 0), true)}
                      <span className="diff-percent">{formatPercent(comparison.original.cachedCost, comparison.replay.cachedCost)}</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Output Cost</td>
                    <td>${(comparison.original.outputCost || 0).toFixed(6)}</td>
                    <td>${(comparison.replay.outputCost || 0).toFixed(6)}</td>
                    <td className={getDiffClass((comparison.replay.outputCost || 0) - (comparison.original.outputCost || 0))}>
                      {formatDiff((comparison.replay.outputCost || 0) - (comparison.original.outputCost || 0), true)}
                      <span className="diff-percent">{formatPercent(comparison.original.outputCost, comparison.replay.outputCost)}</span>
                    </td>
                  </tr>
                  <tr className="total-row">
                    <td>Total Cost</td>
                    <td>${(comparison.original.totalCost || 0).toFixed(6)}</td>
                    <td>${(comparison.replay.totalCost || 0).toFixed(6)}</td>
                    <td className={getDiffClass((comparison.replay.totalCost || 0) - (comparison.original.totalCost || 0))}>
                      {formatDiff((comparison.replay.totalCost || 0) - (comparison.original.totalCost || 0), true)}
                      <span className="diff-percent">{formatPercent(comparison.original.totalCost, comparison.replay.totalCost)}</span>
                    </td>
                  </tr>
                  <tr className="section-header-row">
                    <td colSpan={4}>Performance</td>
                  </tr>
                  <tr>
                    <td>Duration</td>
                    <td>{comparison.original.durationMs}ms</td>
                    <td>{comparison.replay.durationMs}ms</td>
                    <td className={getDiffClass(comparison.diff.durationMs)}>
                      {formatDiff(comparison.diff.durationMs)}ms
                      <span className="diff-percent">{formatPercent(comparison.original.durationMs, comparison.replay.durationMs)}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ReplayModal
