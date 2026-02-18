import { useState, useEffect } from 'react'
import type { ProviderInfo, CompareTarget, CompareResult, CompareMessage, RequestRecord, SavedComparison, TargetSettings } from '../types'
import { loadApiKeys } from '../utils/apiKeys'
import { loadSavedComparisons, saveComparison, deleteComparison } from '../utils/savedComparisons'
import SavedComparisonsModal from './SavedComparisonsModal'

type CompareModalProps = {
  apiBase: string
  onClose: () => void
  onOpenSettings: () => void
  initialRequest?: RequestRecord
}

type ModelsByProvider = Record<string, string[]>

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'

// Extract system prompt and messages from a request body
function extractFromRequestBody(requestBody: unknown): { systemPrompt: string; messages: CompareMessage[] } {
  if (!requestBody || typeof requestBody !== 'object') {
    return { systemPrompt: DEFAULT_SYSTEM_PROMPT, messages: [{ role: 'user', content: '' }] }
  }

  const body = requestBody as {
    system?: string | { text?: string }[]
    messages?: Array<{ role?: string; content?: unknown }>
    contents?: Array<{ role?: string; parts?: Array<{ text?: string }> }>
    systemInstruction?: { parts?: Array<{ text?: string }> }
  }

  let systemPrompt = DEFAULT_SYSTEM_PROMPT
  const messages: CompareMessage[] = []

  // OpenAI format: system message in messages array
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      const role = msg.role as string
      let content = ''

      if (typeof msg.content === 'string') {
        content = msg.content
      } else if (Array.isArray(msg.content)) {
        // Handle content array (OpenAI vision format, etc.)
        content = (msg.content as Array<{ type?: string; text?: string }>)
          .filter(part => part.type === 'text')
          .map(part => part.text || '')
          .join('\n')
      }

      if (role === 'system') {
        systemPrompt = content
      } else if (role === 'user' || role === 'assistant') {
        messages.push({ role, content })
      }
    }
  }

  // Anthropic format: system is separate
  if (body.system) {
    if (typeof body.system === 'string') {
      systemPrompt = body.system
    } else if (Array.isArray(body.system)) {
      systemPrompt = body.system.map(s => s.text || '').join('\n')
    }
  }

  // Gemini format: contents array with systemInstruction
  if (Array.isArray(body.contents)) {
    for (const content of body.contents) {
      const role = content.role === 'model' ? 'assistant' : 'user'
      const text = content.parts?.map(p => p.text || '').join('\n') || ''
      if (text) {
        messages.push({ role, content: text })
      }
    }
    if (body.systemInstruction?.parts) {
      systemPrompt = body.systemInstruction.parts.map(p => p.text || '').join('\n')
    }
  }

  // Ensure at least one message
  if (messages.length === 0) {
    messages.push({ role: 'user', content: '' })
  }

  return { systemPrompt, messages }
}

// Determine provider from request record
function getProviderFromRequest(request: RequestRecord): string {
  if (request.provider) return request.provider
  if (request.path?.includes('anthropic')) return 'anthropic'
  if (request.path?.includes('gemini')) return 'gemini'
  return 'openai'
}

// Strip date suffix from model name for matching
function stripModelSuffix(model: string): string {
  return model.replace(/(-\d{8}|-\d{4}-\d{2}-\d{2})$/, '')
}

function CompareModal({ apiBase, onClose, onOpenSettings, initialRequest }: CompareModalProps) {
  // Extract initial data from request if provided
  const initialData = initialRequest
    ? extractFromRequestBody(initialRequest.request_body)
    : { systemPrompt: DEFAULT_SYSTEM_PROMPT, messages: [{ role: 'user' as const, content: '' }] }

  const [systemPrompt, setSystemPrompt] = useState(initialData.systemPrompt)
  const [messages, setMessages] = useState<CompareMessage[]>(initialData.messages)
  const [targets, setTargets] = useState<CompareTarget[]>([])
  const [maxTokens, setMaxTokens] = useState(1024)
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({})
  const [availableModels, setAvailableModels] = useState<ModelsByProvider>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<CompareResult[] | null>(null)

  // Saved comparisons state
  const [savedComparisons, setSavedComparisons] = useState<SavedComparison[]>([])
  const [currentComparisonId, setCurrentComparisonId] = useState<string | null>(null)
  const [showSavedList, setShowSavedList] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showSavedModal, setShowSavedModal] = useState(false)

  // Expandable target settings state
  const [expandedTargets, setExpandedTargets] = useState<Set<number>>(new Set())

  // Load saved comparisons on mount
  useEffect(() => {
    setSavedComparisons(loadSavedComparisons())
  }, [])

  // Fetch providers and available models
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [providersRes, modelsRes] = await Promise.all([
          fetch(`${apiBase}/api/providers`),
          fetch(`${apiBase}/api/compare/models`)
        ])
        if (providersRes.ok) {
          const data = await providersRes.json() as Record<string, ProviderInfo>
          setProviders(data)
        }
        if (modelsRes.ok) {
          const data = await modelsRes.json() as ModelsByProvider
          setAvailableModels(data)

          // If we have an initial request, pre-populate the target with the original model
          if (initialRequest && initialRequest.model) {
            const provider = getProviderFromRequest(initialRequest)
            const baseModel = stripModelSuffix(initialRequest.model)
            // Find matching model in available models, or use base model name
            const providerModels = data[provider] || []
            const matchingModel = providerModels.find(m => m === baseModel || stripModelSuffix(m) === baseModel) || baseModel
            setTargets([{ provider, model: matchingModel }])
          }
        }
      } catch {
        // ignore fetch errors
      }
    }
    fetchData()
  }, [apiBase, initialRequest])

  const addMessage = () => {
    const lastRole = messages[messages.length - 1]?.role || 'assistant'
    const nextRole = lastRole === 'user' ? 'assistant' : 'user'
    setMessages([...messages, { role: nextRole, content: '' }])
  }

  const updateMessage = (index: number, field: 'role' | 'content', value: string) => {
    const updated = [...messages]
    if (field === 'role') {
      updated[index] = { ...updated[index], role: value as 'user' | 'assistant' }
    } else {
      updated[index] = { ...updated[index], content: value }
    }
    setMessages(updated)
  }

  const removeMessage = (index: number) => {
    if (messages.length > 1) {
      setMessages(messages.filter((_, i) => i !== index))
    }
  }

  const addTarget = () => {
    const providerNames = Object.keys(availableModels)
    const defaultProvider = providerNames[0] || 'openai'
    const defaultModel = availableModels[defaultProvider]?.[0] || ''
    setTargets([...targets, { provider: defaultProvider, model: defaultModel }])
  }

  const updateTarget = (index: number, field: 'provider' | 'model', value: string) => {
    const updated = [...targets]
    if (field === 'provider') {
      const newModel = availableModels[value]?.[0] || ''
      updated[index] = { provider: value, model: newModel }
    } else {
      updated[index] = { ...updated[index], model: value }
    }
    setTargets(updated)
  }

  const removeTarget = (index: number) => {
    setTargets(targets.filter((_, i) => i !== index))
    // Update expanded indices after removal
    const newExpanded = new Set<number>()
    expandedTargets.forEach(i => {
      if (i < index) newExpanded.add(i)
      else if (i > index) newExpanded.add(i - 1)
    })
    setExpandedTargets(newExpanded)
  }

  const toggleTargetExpanded = (index: number) => {
    const newExpanded = new Set(expandedTargets)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedTargets(newExpanded)
  }

  const updateTargetSettings = (index: number, field: keyof TargetSettings, value: string | number | undefined) => {
    const updated = [...targets]
    const currentSettings = updated[index].settings || {}

    if (value === undefined || value === '') {
      // Remove the field if cleared
      const newSettings = { ...currentSettings }
      delete newSettings[field]
      updated[index] = {
        ...updated[index],
        settings: Object.keys(newSettings).length > 0 ? newSettings : undefined
      }
    } else {
      updated[index] = {
        ...updated[index],
        settings: { ...currentSettings, [field]: value }
      }
    }
    setTargets(updated)
  }

  const duplicateTarget = (index: number) => {
    const targetToDuplicate = targets[index]
    const newTarget: CompareTarget = {
      provider: targetToDuplicate.provider,
      model: targetToDuplicate.model,
      settings: targetToDuplicate.settings ? { ...targetToDuplicate.settings } : undefined
    }
    const newTargets = [...targets]
    newTargets.splice(index + 1, 0, newTarget)
    setTargets(newTargets)
    // Auto-expand the new target so user can modify settings
    const newExpanded = new Set(expandedTargets)
    // Shift indices for targets after the insertion point
    const shiftedExpanded = new Set<number>()
    newExpanded.forEach(i => {
      if (i <= index) shiftedExpanded.add(i)
      else shiftedExpanded.add(i + 1)
    })
    shiftedExpanded.add(index + 1)
    setExpandedTargets(shiftedExpanded)
  }

  const handleSave = () => {
    const name = saveName.trim() || `Comparison ${savedComparisons.length + 1}`
    const saved = saveComparison(
      { systemPrompt, messages, targets, maxTokens },
      currentComparisonId || undefined,
      name
    )
    setCurrentComparisonId(saved.id)
    setSavedComparisons(loadSavedComparisons())
    setShowSaveDialog(false)
    setSaveName('')
  }

  const handleLoad = (comparison: SavedComparison) => {
    setSystemPrompt(comparison.systemPrompt)
    setMessages(comparison.messages)
    setTargets(comparison.targets)
    setMaxTokens(comparison.maxTokens)
    setCurrentComparisonId(comparison.id)
    setShowSavedList(false)
    setResults(null)
    setError(null)
  }

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    deleteComparison(id)
    setSavedComparisons(loadSavedComparisons())
    if (currentComparisonId === id) {
      setCurrentComparisonId(null)
    }
  }

  const handleNew = () => {
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT)
    setMessages([{ role: 'user', content: '' }])
    setTargets([])
    setMaxTokens(1024)
    setCurrentComparisonId(null)
    setResults(null)
    setError(null)
    setShowSavedList(false)
  }

  const handleCompare = async () => {
    if (messages.every(m => !m.content.trim())) {
      setError('At least one message is required')
      return
    }
    if (targets.length === 0) {
      setError('At least one model target is required')
      return
    }

    // Load fresh API keys
    const apiKeys = loadApiKeys()

    // Check API keys for all target providers
    const missingKeys = [...new Set(targets.map(t => t.provider))].filter(p => !apiKeys[p])
    if (missingKeys.length > 0) {
      setError(`Missing API keys: ${missingKeys.join(', ')}. Configure in Settings.`)
      return
    }

    setLoading(true)
    setError(null)
    setResults(null)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      // Add API keys for each provider
      for (const [providerName, key] of Object.entries(apiKeys)) {
        const providerInfo = providers[providerName]
        if (providerInfo && key) {
          headers[providerInfo.replayApiKeyHeader] = key
        }
      }

      const filteredMessages = messages.filter(m => m.content.trim())

      const res = await fetch(`${apiBase}/api/compare`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          systemPrompt: systemPrompt.trim() || undefined,
          messages: filteredMessages,
          targets,
          maxTokens,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Comparison failed')
      }

      setResults(data.results as CompareResult[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed')
    } finally {
      setLoading(false)
    }
  }

  const extractResponseText = (result: CompareResult): string => {
    if (!result.success || !result.response) return result.error || 'No response'

    const response = result.response as Record<string, unknown>

    // OpenAI format
    if (response.choices) {
      const choices = response.choices as { message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }[]
      const message = choices[0]?.message
      if (message?.content) {
        return message.content
      }
      // Handle tool calls when content is null
      if (message?.tool_calls && message.tool_calls.length > 0) {
        return message.tool_calls.map(tc =>
          `Tool call: ${tc.function?.name || 'unknown'}\n${tc.function?.arguments || ''}`
        ).join('\n\n')
      }
      return ''
    }

    // Anthropic format
    if (response.content) {
      const content = response.content as { type?: string; text?: string; name?: string; input?: unknown }[]
      const parts: string[] = []
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          parts.push(block.text)
        } else if (block.type === 'tool_use') {
          parts.push(`Tool call: ${block.name || 'unknown'}\n${JSON.stringify(block.input, null, 2)}`)
        }
      }
      return parts.join('\n\n') || ''
    }

    // Gemini format
    if (response.candidates) {
      const candidates = response.candidates as { content?: { parts?: { text?: string; functionCall?: { name?: string; args?: unknown } }[] } }[]
      const parts = candidates[0]?.content?.parts || []
      const textParts: string[] = []
      for (const part of parts) {
        if (part.text) {
          textParts.push(part.text)
        } else if (part.functionCall) {
          textParts.push(`Tool call: ${part.functionCall.name || 'unknown'}\n${JSON.stringify(part.functionCall.args, null, 2)}`)
        }
      }
      return textParts.join('\n\n') || ''
    }

    return JSON.stringify(response, null, 2)
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-left">
            <h3>Compare Models</h3>
            {currentComparisonId && (
              <span className="current-comparison-name">
                {savedComparisons.find(c => c.id === currentComparisonId)?.name}
              </span>
            )}
          </div>
          <div className="modal-header-actions">
            <button
              className="btn-icon"
              onClick={() => setShowSavedModal(true)}
              title="Manage saved comparisons"
            >
              {savedComparisons.length > 0 ? `📁 (${savedComparisons.length})` : '📁'}
            </button>
            <button
              className="btn-icon"
              onClick={() => setShowSavedList(!showSavedList)}
              title="Quick load"
            >
              ⚡
            </button>
            <button
              className="btn-icon"
              onClick={() => setShowSaveDialog(true)}
              title="Save comparison"
            >
              💾
            </button>
            <button
              className="btn-icon"
              onClick={handleNew}
              title="New comparison"
            >
              ✨
            </button>
            <button className="close-btn" onClick={onClose}>&times;</button>
          </div>
        </div>

        {/* Save Dialog */}
        {showSaveDialog && (
          <div className="save-dialog">
            <input
              type="text"
              placeholder="Comparison name..."
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              autoFocus
            />
            <button onClick={handleSave}>Save</button>
            <button onClick={() => { setShowSaveDialog(false); setSaveName('') }}>Cancel</button>
          </div>
        )}

        {/* Saved Comparisons List */}
        {showSavedList && savedComparisons.length > 0 && (
          <div className="saved-comparisons-list">
            {savedComparisons.map(comp => (
              <div
                key={comp.id}
                className={`saved-comparison-item ${comp.id === currentComparisonId ? 'active' : ''}`}
                onClick={() => handleLoad(comp)}
              >
                <div className="saved-comparison-info">
                  <span className="saved-comparison-name">{comp.name}</span>
                  <span className="saved-comparison-meta">
                    {comp.targets.length} model{comp.targets.length !== 1 ? 's' : ''} · {comp.messages.length} msg{comp.messages.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button
                  className="btn-remove"
                  onClick={(e) => handleDelete(comp.id, e)}
                  title="Delete"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="compare-layout">
          {/* Left Panel - Form */}
          <div className="compare-form">
            {/* System Prompt */}
            <div className="compare-section compact">
              <h4>System Prompt</h4>
              <textarea
                className="system-prompt-editor"
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                placeholder="Enter system prompt..."
                rows={2}
              />
            </div>

            {/* Messages */}
            <div className="compare-section compact">
              <div className="section-header">
                <h4>Messages</h4>
                <button onClick={addMessage} className="btn-small">+</button>
              </div>
              <div className="messages-list">
                {messages.map((msg, index) => (
                  <div key={index} className="message-input-row compact">
                    <select
                      value={msg.role}
                      onChange={e => updateMessage(index, 'role', e.target.value)}
                    >
                      <option value="user">U</option>
                      <option value="assistant">A</option>
                    </select>
                    <textarea
                      value={msg.content}
                      onChange={e => updateMessage(index, 'content', e.target.value)}
                      placeholder={`${msg.role} message...`}
                      rows={1}
                    />
                    {messages.length > 1 && (
                      <button className="btn-remove" onClick={() => removeMessage(index)}>&times;</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Models */}
            <div className="compare-section compact">
              <div className="section-header">
                <h4>Models</h4>
                <button onClick={addTarget} className="btn-small">+</button>
              </div>
              <div className="targets-list">
                {targets.map((target, index) => (
                  <div key={index} className="target-container">
                    {/* Main row - always visible */}
                    <div className="target-row compact">
                      <button
                        className="btn-expand"
                        onClick={() => toggleTargetExpanded(index)}
                        title={expandedTargets.has(index) ? 'Collapse settings' : 'Expand settings'}
                      >
                        {expandedTargets.has(index) ? '▼' : '▶'}
                      </button>
                      <select
                        value={target.provider}
                        onChange={e => updateTarget(index, 'provider', e.target.value)}
                        className="provider-select"
                      >
                        {Object.keys(availableModels).map(p => (
                          <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                        ))}
                      </select>
                      <select
                        value={target.model}
                        onChange={e => updateTarget(index, 'model', e.target.value)}
                        className="model-select"
                      >
                        {(availableModels[target.provider] || []).map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      {target.settings && (
                        <span className="settings-indicator" title="Has custom settings">*</span>
                      )}
                      <button
                        className="btn-duplicate"
                        onClick={() => duplicateTarget(index)}
                        title="Duplicate for A/B testing"
                      >
                        ⎘
                      </button>
                      <button className="btn-remove" onClick={() => removeTarget(index)}>&times;</button>
                    </div>

                    {/* Expanded settings panel */}
                    {expandedTargets.has(index) && (
                      <div className="target-settings-panel">
                        <div className="target-setting-row">
                          <label>Temperature:</label>
                          <input
                            type="number"
                            min="0"
                            max="2"
                            step="0.1"
                            value={target.settings?.temperature ?? ''}
                            onChange={e => updateTargetSettings(
                              index,
                              'temperature',
                              e.target.value ? parseFloat(e.target.value) : undefined
                            )}
                            placeholder="Default"
                          />
                        </div>
                        <div className="target-setting-row">
                          <label>System Prompt Override:</label>
                          <textarea
                            value={target.settings?.systemPromptOverride ?? ''}
                            onChange={e => updateTargetSettings(
                              index,
                              'systemPromptOverride',
                              e.target.value || undefined
                            )}
                            placeholder="Leave empty to use global system prompt"
                            rows={2}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {targets.length === 0 && (
                  <div className="no-targets">Click + to add models</div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="compare-actions-row">
              <div className="max-tokens-group">
                <label>Max:</label>
                <input
                  type="number"
                  value={maxTokens}
                  onChange={e => setMaxTokens(parseInt(e.target.value) || 1024)}
                  min={1}
                  max={128000}
                />
              </div>
              <button
                className="btn-compare"
                onClick={handleCompare}
                disabled={loading || targets.length === 0}
              >
                {loading ? 'Running...' : `Run (${targets.length})`}
              </button>
            </div>

            {error && (
              <div className="error-message compact">
                {error}
                {error.includes('Missing API keys') && (
                  <button className="btn-link" onClick={onOpenSettings}>Open Settings</button>
                )}
              </div>
            )}
          </div>

          {/* Right Panel - Results */}
          <div className="compare-results-panel">
            {!results && !loading && (
              <div className="results-placeholder">
                Results will appear here
              </div>
            )}
            {loading && (
              <div className="results-placeholder">
                Running comparisons...
              </div>
            )}
            {results && (
              <>
                {/* Summary Table */}
                <div className="results-summary compact">
                  <table className="comparison-table compact">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>In</th>
                        <th>Out</th>
                        <th>Cost</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result, index) => (
                        <tr key={index} className={result.success ? '' : 'error-row'}>
                          <td className="model-cell">
                            <span className={`provider-tag ${result.target.provider}`}>
                              {result.target.provider.slice(0, 3)}
                            </span>
                            <span className="model-name">{result.model || result.target.model}</span>
                            {result.target.settings && (
                              <span
                                className="custom-settings-badge"
                                title={`Custom: ${[
                                  result.target.settings.systemPromptOverride ? 'System prompt' : '',
                                  result.target.settings.temperature !== undefined ? `Temp=${result.target.settings.temperature}` : ''
                                ].filter(Boolean).join(', ')}`}
                              >
                                *
                              </span>
                            )}
                          </td>
                          <td>{result.inputTokens?.toLocaleString() || '-'}</td>
                          <td>{result.outputTokens?.toLocaleString() || '-'}</td>
                          <td className="cost">${result.totalCost?.toFixed(4) || '-'}</td>
                          <td className="duration">{result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Responses */}
                <div className="responses-list">
                  {results.map((result, index) => (
                    <div key={index} className={`response-item ${result.success ? '' : 'error'}`}>
                      <div className="response-item-header">
                        <span className={`provider-tag ${result.target.provider}`}>
                          {result.target.provider.slice(0, 3)}
                        </span>
                        <span className="model-name">{result.model || result.target.model}</span>
                        {result.success && (
                          <span className="response-stats">
                            ${result.totalCost?.toFixed(4)} | {(result.durationMs! / 1000).toFixed(1)}s
                          </span>
                        )}
                      </div>
                      <div className="response-item-body">
                        <pre>{extractResponseText(result)}</pre>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Saved Comparisons Modal */}
      {showSavedModal && (
        <SavedComparisonsModal
          comparisons={savedComparisons}
          currentComparisonId={currentComparisonId}
          onLoad={(comp) => {
            setSystemPrompt(comp.systemPrompt)
            setMessages(comp.messages)
            setTargets(comp.targets)
            setMaxTokens(comp.maxTokens)
            setCurrentComparisonId(comp.id)
            setResults(null)
            setError(null)
          }}
          onClose={() => setShowSavedModal(false)}
          onUpdate={() => setSavedComparisons(loadSavedComparisons())}
        />
      )}
    </div>
  )
}

export default CompareModal
