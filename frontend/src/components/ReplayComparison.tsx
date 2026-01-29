import { formatDiff, formatPercent, getDiffClass } from '../utils/diffUtils'
import type { RequestRecord } from '../types'

type ReplayComparisonProps = {
  original: RequestRecord
  replay: RequestRecord
}

function ReplayComparison({ original, replay }: ReplayComparisonProps) {
  const diff = {
    inputTokens: (replay.input_tokens || 0) - (original.input_tokens || 0),
    outputTokens: (replay.output_tokens || 0) - (original.output_tokens || 0),
    cachedTokens: (replay.cached_tokens || 0) - (original.cached_tokens || 0),
    inputCost: (replay.input_cost || 0) - (original.input_cost || 0),
    cachedCost: (replay.cached_cost || 0) - (original.cached_cost || 0),
    outputCost: (replay.output_cost || 0) - (original.output_cost || 0),
    totalCost: (replay.total_cost || 0) - (original.total_cost || 0),
    durationMs: (replay.duration_ms || 0) - (original.duration_ms || 0),
  }

  return (
    <div className="comparison-section">
      <h4>Comparison vs Original Request</h4>
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Original</th>
            <th>This Replay</th>
            <th>Difference</th>
          </tr>
        </thead>
        <tbody>
          <tr className="section-header-row">
            <td colSpan={4}>Tokens</td>
          </tr>
          <tr>
            <td>Input Tokens</td>
            <td>{(original.input_tokens || 0).toLocaleString()}</td>
            <td>{(replay.input_tokens || 0).toLocaleString()}</td>
            <td className={getDiffClass(diff.inputTokens)}>
              {formatDiff(diff.inputTokens)}
              <span className="diff-percent">{formatPercent(original.input_tokens, replay.input_tokens)}</span>
            </td>
          </tr>
          <tr>
            <td>Cached Tokens</td>
            <td>{(original.cached_tokens || 0).toLocaleString()}</td>
            <td>{(replay.cached_tokens || 0).toLocaleString()}</td>
            <td className={getDiffClass(diff.cachedTokens, true)}>
              {formatDiff(diff.cachedTokens)}
              <span className="diff-percent">{formatPercent(original.cached_tokens, replay.cached_tokens)}</span>
            </td>
          </tr>
          <tr>
            <td>Output Tokens</td>
            <td>{(original.output_tokens || 0).toLocaleString()}</td>
            <td>{(replay.output_tokens || 0).toLocaleString()}</td>
            <td className={getDiffClass(diff.outputTokens)}>
              {formatDiff(diff.outputTokens)}
              <span className="diff-percent">{formatPercent(original.output_tokens, replay.output_tokens)}</span>
            </td>
          </tr>
          <tr className="section-header-row">
            <td colSpan={4}>Cost Breakdown</td>
          </tr>
          <tr>
            <td>Non-Cached Input Cost</td>
            <td>${(original.input_cost || 0).toFixed(6)}</td>
            <td>${(replay.input_cost || 0).toFixed(6)}</td>
            <td className={getDiffClass(diff.inputCost)}>
              {formatDiff(diff.inputCost, true)}
              <span className="diff-percent">{formatPercent(original.input_cost, replay.input_cost)}</span>
            </td>
          </tr>
          <tr>
            <td>Cached Input Cost</td>
            <td className="cached">${(original.cached_cost || 0).toFixed(6)}</td>
            <td className="cached">${(replay.cached_cost || 0).toFixed(6)}</td>
            <td className={getDiffClass(diff.cachedCost)}>
              {formatDiff(diff.cachedCost, true)}
              <span className="diff-percent">{formatPercent(original.cached_cost, replay.cached_cost)}</span>
            </td>
          </tr>
          <tr>
            <td>Output Cost</td>
            <td>${(original.output_cost || 0).toFixed(6)}</td>
            <td>${(replay.output_cost || 0).toFixed(6)}</td>
            <td className={getDiffClass(diff.outputCost)}>
              {formatDiff(diff.outputCost, true)}
              <span className="diff-percent">{formatPercent(original.output_cost, replay.output_cost)}</span>
            </td>
          </tr>
          <tr className="total-row">
            <td>Total Cost</td>
            <td>${(original.total_cost || 0).toFixed(6)}</td>
            <td>${(replay.total_cost || 0).toFixed(6)}</td>
            <td className={getDiffClass(diff.totalCost)}>
              {formatDiff(diff.totalCost, true)}
              <span className="diff-percent">{formatPercent(original.total_cost, replay.total_cost)}</span>
            </td>
          </tr>
          <tr className="section-header-row">
            <td colSpan={4}>Performance</td>
          </tr>
          <tr>
            <td>Duration</td>
            <td>{original.duration_ms || 0}ms</td>
            <td>{replay.duration_ms || 0}ms</td>
            <td className={getDiffClass(diff.durationMs)}>
              {formatDiff(diff.durationMs)}ms
              <span className="diff-percent">{formatPercent(original.duration_ms, replay.duration_ms)}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default ReplayComparison
