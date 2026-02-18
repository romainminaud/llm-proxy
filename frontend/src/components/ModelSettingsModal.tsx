import { useState, useEffect } from 'react'
import type { CompareTarget, TargetSettings, ResponseFormat, ProviderInfo, GeminiThinkingLevel } from '../types'
import { useAppContext } from '../context/AppContext'
import { loadApiKeys } from '../utils/apiKeys'

type ModelSettingsModalProps = {
  target: CompareTarget
  index: number
  globalSystemPrompt: string
  providers: Record<string, ProviderInfo>
  onSave: (settings: TargetSettings | undefined) => void
  onClose: () => void
}

export default function ModelSettingsModal({ target, index, globalSystemPrompt, providers, onSave, onClose }: ModelSettingsModalProps) {
  const { apiBase } = useAppContext()
  const [temperature, setTemperature] = useState<string>(
    target.settings?.temperature !== undefined ? String(target.settings.temperature) : ''
  )
  const [systemPromptOverride, setSystemPromptOverride] = useState(
    target.settings?.systemPromptOverride || ''
  )
  const [useStructuredOutput, setUseStructuredOutput] = useState(
    !!target.settings?.responseFormat
  )
  const [schemaName, setSchemaName] = useState(
    target.settings?.responseFormat?.json_schema?.name || 'response'
  )
  const [schemaText, setSchemaText] = useState(
    target.settings?.responseFormat?.json_schema?.schema
      ? JSON.stringify(target.settings.responseFormat.json_schema.schema, null, 2)
      : '{\n  "type": "object",\n  "properties": {\n    \n  },\n  "required": [],\n  "additionalProperties": false\n}'
  )
  const [strictMode, setStrictMode] = useState(
    target.settings?.responseFormat?.json_schema?.strict ?? true
  )
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [thinkingLevel, setThinkingLevel] = useState<GeminiThinkingLevel | ''>(
    target.settings?.thinkingLevel || ''
  )

  // Check if the target is a Gemini model
  const isGeminiModel = target.provider === 'gemini'

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [temperature, systemPromptOverride, useStructuredOutput, schemaName, schemaText, strictMode, thinkingLevel])

  const validateSchema = (): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(schemaText)
      if (typeof parsed !== 'object' || parsed === null) {
        setSchemaError('Schema must be a JSON object')
        return null
      }
      setSchemaError(null)
      return parsed
    } catch (e) {
      setSchemaError(`Invalid JSON: ${e instanceof Error ? e.message : 'Parse error'}`)
      return null
    }
  }

  const handleSave = () => {
    const settings: TargetSettings = {}

    if (temperature !== '') {
      settings.temperature = parseFloat(temperature)
    }
    if (systemPromptOverride.trim()) {
      settings.systemPromptOverride = systemPromptOverride.trim()
    }
    if (useStructuredOutput) {
      const schema = validateSchema()
      if (!schema) return // Don't save if schema is invalid

      const responseFormat: ResponseFormat = {
        type: 'json_schema',
        json_schema: {
          name: schemaName.trim() || 'response',
          schema,
          strict: strictMode,
        },
      }
      settings.responseFormat = responseFormat
    }
    if (thinkingLevel !== '') {
      settings.thinkingLevel = thinkingLevel
    }

    onSave(Object.keys(settings).length > 0 ? settings : undefined)
    onClose()
  }

  const handleClear = () => {
    setTemperature('')
    setSystemPromptOverride('')
    setUseStructuredOutput(false)
    setSchemaName('response')
    setSchemaText('{\n  "type": "object",\n  "properties": {\n    \n  },\n  "required": [],\n  "additionalProperties": false\n}')
    setStrictMode(true)
    setSchemaError(null)
    setThinkingLevel('')
  }

  const handleGenerateSchema = async () => {
    const effectiveSystemPrompt = systemPromptOverride.trim() || globalSystemPrompt
    if (!effectiveSystemPrompt) {
      setSchemaError('No system prompt available to generate schema from')
      return
    }

    // Get API keys
    const apiKeys = loadApiKeys()
    const openaiKey = apiKeys['openai']
    if (!openaiKey) {
      setSchemaError('OpenAI API key required for schema generation. Configure in Settings.')
      return
    }

    setGenerating(true)
    setSchemaError(null)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      // Add all API keys to headers
      for (const [providerName, key] of Object.entries(apiKeys)) {
        const providerInfo = providers[providerName]
        if (providerInfo && key) {
          headers[providerInfo.replayApiKeyHeader] = key
        }
      }

      const res = await fetch(`${apiBase}/api/compare/generate-schema`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          systemPrompt: effectiveSystemPrompt,
          provider: 'openai',
          model: 'gpt-4o-mini',
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Schema generation failed')
      }

      setSchemaText(JSON.stringify(data.schema, null, 2))
      if (data.schemaName) {
        setSchemaName(data.schemaName)
      }
    } catch (err) {
      setSchemaError(err instanceof Error ? err.message : 'Schema generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const hasSettings = temperature !== '' || systemPromptOverride.trim() !== '' || useStructuredOutput || thinkingLevel !== ''
  const effectiveSystemPrompt = systemPromptOverride.trim() || globalSystemPrompt

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content model-settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings for {target.provider} / {target.model}</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="model-settings-content">
          <div className="model-settings-row">
            <label>Temperature</label>
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={e => setTemperature(e.target.value)}
              placeholder="Default (provider's default)"
            />
            <span className="settings-help">0 = deterministic, 1 = balanced, 2 = creative</span>
          </div>

          {isGeminiModel && (
            <div className="model-settings-row">
              <label>Thinking Level</label>
              <select
                value={thinkingLevel}
                onChange={e => setThinkingLevel(e.target.value as GeminiThinkingLevel | '')}
              >
                <option value="">Default (no thinking)</option>
                <option value="none">None (disabled)</option>
                <option value="low">Low (1,024 tokens)</option>
                <option value="medium">Medium (8,192 tokens)</option>
                <option value="high">High (24,576 tokens)</option>
              </select>
              <span className="settings-help">Budget for Gemini's extended thinking. Only works with thinking-capable models (e.g., gemini-2.5-flash-preview-04-17)</span>
            </div>
          )}

          <div className="model-settings-row">
            <label>System Prompt Override</label>
            <textarea
              value={systemPromptOverride}
              onChange={e => setSystemPromptOverride(e.target.value)}
              placeholder="Leave empty to use the global system prompt"
              rows={4}
            />
            <span className="settings-help">Override the global system prompt for this model only</span>
          </div>

          <div className="model-settings-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={useStructuredOutput}
                onChange={e => setUseStructuredOutput(e.target.checked)}
              />
              Structured Output (JSON Schema)
            </label>
            <span className="settings-help">Force the model to respond with a specific JSON structure</span>
          </div>

          {useStructuredOutput && (
            <div className="structured-output-settings">
              <div className="model-settings-row-inline">
                <div className="inline-field">
                  <label>Schema Name</label>
                  <input
                    type="text"
                    value={schemaName}
                    onChange={e => setSchemaName(e.target.value)}
                    placeholder="response"
                  />
                </div>
                <div className="inline-field">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={strictMode}
                      onChange={e => setStrictMode(e.target.checked)}
                    />
                    Strict mode
                  </label>
                </div>
              </div>
              <div className="model-settings-row">
                <div className="schema-label-row">
                  <label>JSON Schema</label>
                  <button
                    className="btn-generate-schema"
                    onClick={handleGenerateSchema}
                    disabled={generating || !effectiveSystemPrompt}
                    title={!effectiveSystemPrompt ? 'No system prompt to generate from' : 'Generate schema from system prompt using AI'}
                  >
                    {generating ? 'Generating...' : 'Generate from prompt'}
                  </button>
                </div>
                <textarea
                  className={`schema-editor ${schemaError ? 'has-error' : ''}`}
                  value={schemaText}
                  onChange={e => {
                    setSchemaText(e.target.value)
                    setSchemaError(null)
                  }}
                  placeholder="Enter JSON schema..."
                  rows={10}
                  spellCheck={false}
                />
                {schemaError && <span className="schema-error">{schemaError}</span>}
                <span className="settings-help">
                  Define the expected response structure. Use standard JSON Schema format.
                </span>
              </div>
            </div>
          )}

          <div className="model-settings-actions">
            <span className="model-settings-hint">Cmd+S to save, Esc to cancel</span>
            {hasSettings && (
              <button className="btn-secondary" onClick={handleClear}>Clear All</button>
            )}
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
