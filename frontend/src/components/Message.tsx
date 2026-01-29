import { estimateTokens, getMessageContent } from '../utils/messageUtils'
import type { MessageLike } from '../types'

type MessageProps = {
  message: MessageLike
  index: number
}

function Message({ message, index }: MessageProps) {
  const role = message.role || 'unknown'
  const content = getMessageContent(message)
  const tokenEstimate = estimateTokens(message)

  return (
    <div className={`message message-${role}`}>
      <div className="message-role">
        <span className="message-index">#{index}</span>
        {role}
        <span className="message-tokens" title="Approximate token count">
          ~{tokenEstimate.toLocaleString()} tokens
        </span>
      </div>
      <div className="message-content">
        {typeof content === 'string' ? (
          <div className="message-text">{content}</div>
        ) : (
          content.map((part, i) => (
            <div key={i} className={`message-part message-part-${part.type}`}>
              {part.type === 'text' && <div className="message-text">{part.text}</div>}
              {part.type === 'image_url' && (
                <div className="message-image">
                  <span className="image-badge">Image</span>
                  {part.image_url?.url?.startsWith('data:') ? (
                    <span className="image-info">Base64 encoded</span>
                  ) : (
                    <a href={part.image_url?.url} target="_blank" rel="noopener noreferrer">
                      {part.image_url?.url?.substring(0, 50)}...
                    </a>
                  )}
                </div>
              )}
              {part.type === 'tool_use' && (
                <div className="tool-call">
                  <div className="tool-name">Tool: {part.name}</div>
                  <pre>{JSON.stringify(part.input, null, 2)}</pre>
                </div>
              )}
              {part.type === 'tool_result' && (
                <div className="tool-result">
                  <div className="tool-name">Tool Result</div>
                  <pre>{typeof part.content === 'string' ? part.content : JSON.stringify(part.content, null, 2)}</pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default Message
