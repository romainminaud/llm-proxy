import { useEffect, useRef, useState } from 'react'
import { estimateTokens, getMessageContent, normalizeResponsesItem } from '../utils/messageUtils'
import type { MessageLike, RequestRecord } from '../types'
import Message from './Message'
import ReplayComparison from './ReplayComparison'

type RequestDetailProps = {
  request: RequestRecord
  apiBase: string
  onCopyId?: (id: string) => void
  copiedId: string | null
}

function RequestDetail({ request: r, apiBase, onCopyId, copiedId }: RequestDetailProps) {
  const [showRawRequest, setShowRawRequest] = useState(false)
  const [showRawResponse, setShowRawResponse] = useState(false)
  const [currentMsgIndex, setCurrentMsgIndex] = useState(0)
  const [originalRequest, setOriginalRequest] = useState<RequestRecord | null>(null)
  const messageRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    if (r.replay_of) {
      fetch(`${apiBase}/api/requests/${r.replay_of}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => setOriginalRequest(data))
        .catch(() => setOriginalRequest(null))
    }
  }, [apiBase, r.replay_of])

  const getInputMessages = (): MessageLike[] => {
    if (r.request_body?.messages) {
      return r.request_body.messages as MessageLike[]
    }
    if (r.request_body?.contents) {
      return (r.request_body.contents as Array<{ role?: string; parts?: Array<{ text?: string }> }>)
        .map(item => ({
          role: item.role || 'user',
          content: item.parts?.map(p => p.text || '').join('') || '',
        }))
    }
    // OpenAI Responses API: input is a string or a list of mixed items
    // (messages, function_call, function_call_output, reasoning, …)
    if (r.request_body?.input) {
      const input = r.request_body.input
      if (typeof input === 'string') {
        return [{ role: 'user', content: input }]
      }
      if (Array.isArray(input)) {
        return input
          .map(normalizeResponsesItem)
          .filter((message): message is MessageLike => message !== null)
      }
    }
    return []
  }

  const getOutputMessages = (): MessageLike[] => {
    if (r.response_body?.choices) {
      return r.response_body.choices
        .map((choice: { message?: MessageLike }) => choice.message)
        .filter((message: MessageLike | undefined): message is MessageLike => Boolean(message))
    }
    if (r.response_body?.candidates) {
      return (r.response_body.candidates as Array<{
        content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: unknown } }> }
      }>)
        .map(candidate => {
          const parts = candidate.content?.parts || []
          const text = parts.filter(p => p.text).map(p => p.text!).join('')
          const fnCall = parts.find(p => p.functionCall)?.functionCall
          const content = fnCall
            ? `[Function call: ${fnCall.name}]\n${JSON.stringify(fnCall.args, null, 2)}`
            : text
          return { role: 'assistant', content }
        })
        .filter(m => Boolean(m.content))
    }
    // Anthropic native shape: { content: [{type:'text',text}, {type:'tool_use',...}, ...] }
    if (Array.isArray(r.response_body?.content)) {
      const blocks = r.response_body.content as Array<{
        type?: string
        text?: string
        thinking?: string
        name?: string
        input?: unknown
      }>
      const parts = blocks.map(block => {
        if (block.type === 'text') return block.text || ''
        if (block.type === 'thinking') return block.thinking ? `[Thinking]\n${block.thinking}` : ''
        if (block.type === 'tool_use') {
          return `[Tool call: ${block.name}]\n${JSON.stringify(block.input, null, 2)}`
        }
        return ''
      }).filter(Boolean)
      return parts.length ? [{ role: 'assistant', content: parts.join('\n\n') }] : []
    }
    // OpenAI Responses API: output mixes messages, function_call items, and reasoning
    if (r.response_body?.output) {
      return (r.response_body.output as unknown[])
        .map(normalizeResponsesItem)
        .filter((message): message is MessageLike => message !== null)
    }
    return []
  }

  const inputMessages = getInputMessages()
  const outputMessages = getOutputMessages()
  const allMessages = [...inputMessages, ...outputMessages]
  const totalMessages = allMessages.length

  const scrollToMessage = (index: number) => {
    if (index >= 0 && index < totalMessages && messageRefs.current[index]) {
      messageRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setCurrentMsgIndex(index)
    }
  }

  const goToPrev = () => scrollToMessage(currentMsgIndex - 1)
  const goToNext = () => scrollToMessage(currentMsgIndex + 1)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        goToPrev()
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        goToNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentMsgIndex, totalMessages])

  const getExcerpt = (msg: MessageLike) => {
    const content = getMessageContent(msg)
    if (typeof content === 'string') {
      return content.substring(0, 80) + (content.length > 80 ? '...' : '')
    }
    if (Array.isArray(content)) {
      const textPart = content.find(part => part.type === 'text')
      if (textPart) {
        return textPart.text.substring(0, 80) + (textPart.text.length > 80 ? '...' : '')
      }
      const firstType = content[0]?.type
      if (firstType === 'image_url') return '[Image]'
      if (firstType === 'tool_use') {
        const toolName = content[0]?.type === 'tool_use' ? content[0].name : undefined
        return toolName ? `[Tool: ${toolName}]` : '[Tool]'
      }
      if (firstType === 'tool_result') return '[Tool Result]'
    }
    return '[No content]'
  }

  return (
    <div className="detail-layout">
      <div className="detail-sidebar">
        <div className="sidebar-header">
          <span className="sidebar-title">Messages</span>
          <span className="sidebar-count">{totalMessages}</span>
        </div>
        <div className="sidebar-list">
          {allMessages.map((msg, i) => {
            const tokenEstimate = estimateTokens(msg)
            return (
              <div
                key={i}
                className={`sidebar-item sidebar-item-${msg.role} ${i === currentMsgIndex ? 'active' : ''}`}
                onClick={() => scrollToMessage(i)}
              >
                <div className="sidebar-item-header">
                  <span className="sidebar-item-index">#{i + 1}</span>
                  <span className="sidebar-item-role">{msg.role}</span>
                  <span className="sidebar-item-tokens" title="Approximate token count">
                    ~{tokenEstimate.toLocaleString()}
                  </span>
                </div>
                <div className="sidebar-item-excerpt">{getExcerpt(msg)}</div>
              </div>
            )
          })}
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-meta">
            <div><strong>Model:</strong> {r.model || 'N/A'}</div>
            <div><strong>Duration:</strong> {r.duration_ms}ms</div>
            <div>
              <strong>Tokens:</strong> {r.input_tokens ?? 0} → {r.output_tokens ?? 0}
              {(r.cached_tokens || r.response_body?.usage?.prompt_tokens_details?.cached_tokens)
                ? ` (${r.cached_tokens || r.response_body?.usage?.prompt_tokens_details?.cached_tokens} cached)`
                : ''}
            </div>
            {(r.cache_write_tokens ?? 0) > 0 && (
              <div>
                <strong>Cache write:</strong> {(r.cache_write_tokens ?? 0).toLocaleString()}
                {r.cache_write_cost ? ` ($${r.cache_write_cost.toFixed(6)})` : ''}
              </div>
            )}
            {(r.reasoning_tokens ?? 0) > 0 && (
              <div><strong>Reasoning:</strong> {(r.reasoning_tokens ?? 0).toLocaleString()}</div>
            )}
            {r.stop_reason && <div><strong>Stop:</strong> {r.stop_reason}</div>}
            {typeof r.tools_defined_count === 'number' && (
              <div><strong>Tools defined:</strong> {r.tools_defined_count}</div>
            )}
            <div><strong>Cost:</strong> <span className="cost">${(r.total_cost || 0).toFixed(6)}</span></div>
          </div>
        </div>
      </div>

      <div className="detail-main">
        {r.error && <div className="error-banner">{r.error}</div>}

        <div className="conversation">
          {allMessages.map((msg, i) => (
            <div
              key={i}
              ref={el => { messageRefs.current[i] = el }}
              className={i === currentMsgIndex ? 'message-highlight' : ''}
            >
              <Message message={msg} index={i + 1} />
            </div>
          ))}
          {totalMessages === 0 && (
            <div className="no-messages">No conversation data available</div>
          )}
        </div>

        <div className="detail-raw-section">
          <div className="raw-toggle-row">
            <button className="toggle-btn" onClick={() => setShowRawRequest(!showRawRequest)}>
              {showRawRequest ? 'Hide' : 'Show'} Request JSON
            </button>
            {r.response_body && (
              <button className="toggle-btn" onClick={() => setShowRawResponse(!showRawResponse)}>
                {showRawResponse ? 'Hide' : 'Show'} Response JSON
              </button>
            )}
          </div>
          {showRawRequest && (
            <pre>{JSON.stringify(r.request_body, null, 2)}</pre>
          )}
          {showRawResponse && r.response_body && (
            <pre>{JSON.stringify(r.response_body, null, 2)}</pre>
          )}
        </div>

        {r.replay_of && originalRequest && (
          <ReplayComparison original={originalRequest} replay={r} />
        )}

        <div className="meta-section">
          <div className="meta-item meta-item-id">
            <span>ID:</span>
            <span className="meta-id" title={r.id}>{r.id}</span>
            <button className="copy-btn copy-btn-small" onClick={() => onCopyId?.(r.id)}>
              {copiedId === r.id ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="meta-item"><span>Time:</span> {new Date(r.timestamp).toLocaleString()}</div>
          <div className="meta-item"><span>Path:</span> {r.path}</div>
          {r.session_id && (
            <div className="meta-item meta-item-id">
              <span>Session:</span>
              <span className="meta-id" title={r.session_id}>{r.session_id}</span>
              <button className="copy-btn copy-btn-small" onClick={() => onCopyId?.(r.session_id!)}>
                {copiedId === r.session_id ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
          {r.agent_entrypoint && (
            <div className="meta-item">
              <span>Agent:</span> {r.agent_entrypoint}{r.agent_version ? ` v${r.agent_version}` : ''}
            </div>
          )}
          {r.replay_of && (
            <div className="meta-item"><span>Replay of:</span> {r.replay_of}</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default RequestDetail
