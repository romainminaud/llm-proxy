import { useState, useMemo } from 'react'
import type { CompareResult } from '../types'

type ResponseViewerModalProps = {
  result: CompareResult
  onClose: () => void
}

export default function ResponseViewerModal({ result, onClose }: ResponseViewerModalProps) {
  const [viewMode, setViewMode] = useState<'text' | 'json'>('text')
  const [copied, setCopied] = useState(false)

  const responseText = useMemo(() => {
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
  }, [result])

  // Try to parse response text as JSON for pretty display
  const parsedJson = useMemo(() => {
    try {
      return JSON.parse(responseText)
    } catch {
      return null
    }
  }, [responseText])

  const isJsonContent = parsedJson !== null

  const handleCopy = async () => {
    const textToCopy = viewMode === 'json' && isJsonContent
      ? JSON.stringify(parsedJson, null, 2)
      : responseText
    await navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyRaw = async () => {
    await navigator.clipboard.writeText(JSON.stringify(result.response, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content response-viewer-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="response-viewer-header-left">
            <span className={`provider-tag ${result.target.provider}`}>
              {result.target.provider.slice(0, 3).toUpperCase()}
            </span>
            <h3>{result.model || result.target.model}</h3>
          </div>
          <div className="response-viewer-header-right">
            <span className="response-viewer-stats">
              {result.inputTokens?.toLocaleString()} in · {result.outputTokens?.toLocaleString()} out · ${result.totalCost?.toFixed(4)} · {(result.durationMs! / 1000).toFixed(1)}s
            </span>
            <button className="close-btn" onClick={onClose}>&times;</button>
          </div>
        </div>
        <div className="response-viewer-toolbar">
          <div className="response-viewer-tabs">
            <button
              className={`tab-btn ${viewMode === 'text' ? 'active' : ''}`}
              onClick={() => setViewMode('text')}
            >
              Text
            </button>
            {isJsonContent && (
              <button
                className={`tab-btn ${viewMode === 'json' ? 'active' : ''}`}
                onClick={() => setViewMode('json')}
              >
                JSON
              </button>
            )}
          </div>
          <div className="response-viewer-actions">
            <button className="btn-small" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button className="btn-small" onClick={handleCopyRaw}>
              Copy Raw
            </button>
          </div>
        </div>
        <div className="response-viewer-content">
          {viewMode === 'text' && (
            <pre className="response-text">{responseText}</pre>
          )}
          {viewMode === 'json' && isJsonContent && (
            <div className="json-viewer">
              <JsonTree data={parsedJson} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Simple JSON tree viewer component
function JsonTree({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 2)

  if (data === null) return <span className="json-null">null</span>
  if (typeof data === 'boolean') return <span className="json-boolean">{data.toString()}</span>
  if (typeof data === 'number') return <span className="json-number">{data}</span>
  if (typeof data === 'string') {
    // Check if it's a long string
    if (data.length > 100) {
      return (
        <span className="json-string json-string-long">
          "{data.slice(0, 100)}..."
          <button className="json-expand-btn" onClick={() => alert(data)}>Show full</button>
        </span>
      )
    }
    return <span className="json-string">"{data}"</span>
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="json-bracket">[]</span>

    return (
      <span className="json-array">
        <span className="json-bracket clickable" onClick={() => setCollapsed(!collapsed)}>
          [{collapsed ? `...${data.length} items` : ''}
        </span>
        {!collapsed && (
          <div className="json-children">
            {data.map((item, index) => (
              <div key={index} className="json-item">
                <span className="json-index">{index}:</span>
                <JsonTree data={item} depth={depth + 1} />
                {index < data.length - 1 && <span className="json-comma">,</span>}
              </div>
            ))}
          </div>
        )}
        <span className="json-bracket">{collapsed ? '' : ']'}</span>
      </span>
    )
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0) return <span className="json-bracket">{'{}'}</span>

    return (
      <span className="json-object">
        <span className="json-bracket clickable" onClick={() => setCollapsed(!collapsed)}>
          {'{'}{collapsed ? `...${entries.length} keys` : ''}
        </span>
        {!collapsed && (
          <div className="json-children">
            {entries.map(([key, value], index) => (
              <div key={key} className="json-item">
                <span className="json-key">"{key}"</span>
                <span className="json-colon">: </span>
                <JsonTree data={value} depth={depth + 1} />
                {index < entries.length - 1 && <span className="json-comma">,</span>}
              </div>
            ))}
          </div>
        )}
        <span className="json-bracket">{collapsed ? '' : '}'}</span>
      </span>
    )
  }

  return <span>{String(data)}</span>
}
