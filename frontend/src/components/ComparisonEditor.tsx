import { useState, useEffect } from 'react'
import type { ProviderInfo, CompareTarget, CompareResult, CompareMessage, RequestRecord, SavedComparison, TargetSettings } from '../types'
import { loadApiKeys } from '../utils/apiKeys'
import { saveComparison } from '../utils/savedComparisons'
import { useAppContext } from '../context/AppContext'
import MessageEditModal from './MessageEditModal'
import ModelSettingsModal from './ModelSettingsModal'
import ResponseViewerModal from './ResponseViewerModal'
import SystemPromptEditModal from './SystemPromptEditModal'

type ComparisonEditorProps = {
  comparison: SavedComparison | null
  initialRequest?: RequestRecord | null
  onSave: (comparison: SavedComparison) => void
  onOpenSettings: () => void
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

export default function ComparisonEditor({ comparison, initialRequest, onSave, onOpenSettings }: ComparisonEditorProps) {
  const { apiBase } = useAppContext()

  // Get initial data
  const getInitialData = () => {
    if (comparison) {
      return {
        systemPrompt: comparison.systemPrompt,
        messages: comparison.messages,
        targets: comparison.targets,
        maxTokens: comparison.maxTokens,
      }
    }
    if (initialRequest) {
      const extracted = extractFromRequestBody(initialRequest.request_body)
      return {
        systemPrompt: extracted.systemPrompt,
        messages: extracted.messages,
        targets: [] as CompareTarget[],
        maxTokens: 1024,
      }
    }
    return {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: '' }],
      targets: [] as CompareTarget[],
      maxTokens: 1024,
    }
  }

  const initialData = getInitialData()

  const [systemPrompt, setSystemPrompt] = useState(initialData.systemPrompt)
  const [messages, setMessages] = useState<CompareMessage[]>(initialData.messages)
  const [targets, setTargets] = useState<CompareTarget[]>(initialData.targets)
  const [maxTokens, setMaxTokens] = useState(initialData.maxTokens)
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({})
  const [availableModels, setAvailableModels] = useState<ModelsByProvider>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<CompareResult[] | null>(null)
  const [saveName, setSaveName] = useState(comparison?.name || '')
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null)
  const [messagesCollapsed, setMessagesCollapsed] = useState(false)
  const [editingTargetIndex, setEditingTargetIndex] = useState<number | null>(null)
  const [viewingResultIndex, setViewingResultIndex] = useState<number | null>(null)
  const [editingSystemPrompt, setEditingSystemPrompt] = useState(false)

  // Reset state when comparison or initialRequest changes
  useEffect(() => {
    const data = getInitialData()
    setSystemPrompt(data.systemPrompt)
    setMessages(data.messages)
    setTargets(data.targets)
    setMaxTokens(data.maxTokens)
    setSaveName(comparison?.name || '')
    setResults(comparison?.lastResults || null)
    setError(null)
  }, [comparison?.id, initialRequest?.id])

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

          // If we have an initial request and no targets yet, pre-populate
          if (initialRequest && initialRequest.model && targets.length === 0) {
            const provider = getProviderFromRequest(initialRequest)
            const baseModel = stripModelSuffix(initialRequest.model)
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
  }, [apiBase])

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

  const updateMessageFull = (index: number, content: string, role: 'user' | 'assistant') => {
    const updated = [...messages]
    updated[index] = { role, content }
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
  }

  const updateTargetSettings = (index: number, settings: TargetSettings | undefined) => {
    const updated = [...targets]
    updated[index] = { ...updated[index], settings }
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
  }

  const handleSave = (includeResults = true) => {
    const name = saveName.trim() || `Comparison ${Date.now()}`
    const saved = saveComparison(
      { systemPrompt, messages, targets, maxTokens, lastResults: includeResults && results ? results : undefined },
      comparison?.id,
      name
    )
    onSave(saved)
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

    const apiKeys = loadApiKeys()
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

      const newResults = data.results as CompareResult[]
      setResults(newResults)

      // Auto-save results if we have an existing comparison
      if (comparison?.id) {
        const name = saveName.trim() || comparison.name
        const saved = saveComparison(
          { systemPrompt, messages, targets, maxTokens, lastResults: newResults },
          comparison.id,
          name
        )
        onSave(saved)
      }
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
    <div className="comparison-editor">
      {/* Header */}
      <div className="comparison-editor-header">
        <input
          type="text"
          className="comparison-name-input"
          placeholder="Comparison name..."
          value={saveName}
          onChange={e => setSaveName(e.target.value)}
        />
        <div className="header-actions">
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
          <button className="btn-save" onClick={handleSave}>
            Save
          </button>
          <button
            className="btn-run"
            onClick={handleCompare}
            disabled={loading || targets.length === 0}
          >
            {loading ? 'Running...' : `Run (${targets.length})`}
          </button>
        </div>
      </div>

      <div className="comparison-editor-body">
        {/* Left Panel - Form */}
        <div className="comparison-editor-form">
          {/* System Prompt */}
          <div className="compare-section">
            <div className="section-header">
              <h4>System Prompt</h4>
              <button onClick={() => setEditingSystemPrompt(true)} className="btn-small">Edit</button>
            </div>
            <div
              className="system-prompt-preview"
              onClick={() => setEditingSystemPrompt(true)}
              title="Click to edit"
            >
              {systemPrompt ? (
                <span className="system-prompt-text">
                  {systemPrompt.length > 150 ? systemPrompt.slice(0, 150) + '...' : systemPrompt}
                </span>
              ) : (
                <span className="system-prompt-placeholder">Click to add system prompt...</span>
              )}
            </div>
          </div>

          {/* System Prompt Edit Modal */}
          {editingSystemPrompt && (
            <SystemPromptEditModal
              systemPrompt={systemPrompt}
              onSave={setSystemPrompt}
              onClose={() => setEditingSystemPrompt(false)}
            />
          )}

          {/* Messages */}
          <div className={`compare-section ${messagesCollapsed ? 'collapsed' : ''}`}>
            <div className="section-header clickable" onClick={() => setMessagesCollapsed(!messagesCollapsed)}>
              <div className="section-header-left">
                <span className="collapse-icon">{messagesCollapsed ? '▶' : '▼'}</span>
                <h4>Messages ({messages.length})</h4>
              </div>
              <button onClick={(e) => { e.stopPropagation(); addMessage(); }} className="btn-small">+</button>
            </div>
            {!messagesCollapsed && (
              <div className="messages-compact-list">
                {messages.map((msg, index) => (
                  <div key={index} className="message-compact-row">
                    <span className={`message-role-badge role-${msg.role}`}>
                      {msg.role === 'user' ? 'U' : 'A'}
                    </span>
                    <span className="message-preview" title={msg.content}>
                      {msg.content ? (msg.content.length > 40 ? msg.content.slice(0, 40) + '...' : msg.content) : '(empty)'}
                    </span>
                    <button
                      className="message-edit-btn"
                      onClick={() => setEditingMessageIndex(index)}
                    >
                      Edit
                    </button>
                    {messages.length > 1 && (
                      <button className="btn-remove" onClick={() => removeMessage(index)}>&times;</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Message Edit Modal */}
          {editingMessageIndex !== null && (
            <MessageEditModal
              message={messages[editingMessageIndex]}
              index={editingMessageIndex}
              onSave={(content, role) => updateMessageFull(editingMessageIndex, content, role)}
              onClose={() => setEditingMessageIndex(null)}
            />
          )}

          {/* Models */}
          <div className="compare-section">
            <div className="section-header">
              <h4>Models</h4>
              <button onClick={addTarget} className="btn-small">+</button>
            </div>
            <div className="targets-list">
              {targets.map((target, index) => (
                <div key={index} className="target-row">
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
                  <button
                    className={`btn-settings ${target.settings ? 'has-settings' : ''}`}
                    onClick={() => setEditingTargetIndex(index)}
                    title="Model settings"
                  >
                    ⚙
                  </button>
                  <button
                    className="btn-duplicate"
                    onClick={() => duplicateTarget(index)}
                    title="Duplicate"
                  >
                    ⎘
                  </button>
                  <button className="btn-remove" onClick={() => removeTarget(index)}>&times;</button>
                </div>
              ))}
              {targets.length === 0 && (
                <div className="no-targets">Click + to add models</div>
              )}
            </div>
          </div>

          {/* Model Settings Modal */}
          {editingTargetIndex !== null && (
            <ModelSettingsModal
              target={targets[editingTargetIndex]}
              index={editingTargetIndex}
              globalSystemPrompt={systemPrompt}
              providers={providers}
              onSave={(settings) => updateTargetSettings(editingTargetIndex, settings)}
              onClose={() => setEditingTargetIndex(null)}
            />
          )}

          {error && (
            <div className="error-message">
              {error}
              {error.includes('Missing API keys') && (
                <button className="btn-link" onClick={onOpenSettings}>Open Settings</button>
              )}
            </div>
          )}
        </div>

        {/* Right Panel - Results */}
        <div className="comparison-editor-results">
          {!results && !loading && (
            <div className="results-placeholder">
              Results will appear here after running the comparison
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
              <div className="results-summary">
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Input</th>
                      <th>Output</th>
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
                {results.map((result, index) => {
                  const responseText = extractResponseText(result)
                  const isJson = responseText.trim().startsWith('{') || responseText.trim().startsWith('[')

                  return (
                    <div key={index} className={`response-item ${result.success ? '' : 'error'}`}>
                      <div className="response-item-header">
                        <span className={`provider-tag ${result.target.provider}`}>
                          {result.target.provider.slice(0, 3).toUpperCase()}
                        </span>
                        <span className="model-name">{result.model || result.target.model}</span>
                        {result.success && (
                          <span className="response-stats">
                            ${result.totalCost?.toFixed(4)} | {(result.durationMs! / 1000).toFixed(1)}s
                          </span>
                        )}
                        <button
                          className="btn-expand-response"
                          onClick={() => setViewingResultIndex(index)}
                          title="View full response"
                        >
                          Expand
                        </button>
                      </div>
                      <div className={`response-item-body ${isJson ? 'is-json' : ''}`}>
                        <pre>{isJson ? formatJsonPreview(responseText) : responseText}</pre>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Response Viewer Modal */}
              {viewingResultIndex !== null && results[viewingResultIndex] && (
                <ResponseViewerModal
                  result={results[viewingResultIndex]}
                  onClose={() => setViewingResultIndex(null)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Format JSON for preview (pretty print first few lines)
function formatJsonPreview(text: string): string {
  try {
    const parsed = JSON.parse(text)
    const formatted = JSON.stringify(parsed, null, 2)
    const lines = formatted.split('\n')
    if (lines.length > 15) {
      return lines.slice(0, 15).join('\n') + '\n...'
    }
    return formatted
  } catch {
    return text
  }
}
