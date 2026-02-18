import { useState, useEffect, useRef } from 'react'
import type { CompareMessage } from '../types'

type MessageEditModalProps = {
  message: CompareMessage
  index: number
  onSave: (content: string, role: 'user' | 'assistant') => void
  onClose: () => void
}

export default function MessageEditModal({ message, index, onSave, onClose }: MessageEditModalProps) {
  const [role, setRole] = useState<'user' | 'assistant'>(message.role === 'system' ? 'user' : message.role)
  const [content, setContent] = useState(message.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Auto-focus and select content
    if (textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(0, 0)
    }
  }, [])

  const handleSave = () => {
    onSave(content, role)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
    if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content message-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Message {index + 1}</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="message-edit-content" onKeyDown={handleKeyDown}>
          <div className="message-edit-role">
            <label>Role</label>
            <select value={role} onChange={e => setRole(e.target.value as 'user' | 'assistant')}>
              <option value="user">User</option>
              <option value="assistant">Assistant</option>
            </select>
          </div>
          <div className="message-edit-body">
            <label>Content</label>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Enter message content..."
            />
          </div>
          <div className="message-edit-actions">
            <span className="message-edit-hint">Cmd+S to save, Esc to cancel</span>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
