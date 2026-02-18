import { useState, useEffect, useRef } from 'react'

type SystemPromptEditModalProps = {
  systemPrompt: string
  onSave: (content: string) => void
  onClose: () => void
}

export default function SystemPromptEditModal({ systemPrompt, onSave, onClose }: SystemPromptEditModalProps) {
  const [content, setContent] = useState(systemPrompt)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Auto-focus and place cursor at end
    if (textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(0, 0)
    }
  }, [])

  const handleSave = () => {
    onSave(content)
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
      <div className="modal-content system-prompt-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit System Prompt</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="system-prompt-edit-content" onKeyDown={handleKeyDown}>
          <div className="system-prompt-edit-body">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Enter system prompt..."
            />
          </div>
          <div className="system-prompt-edit-actions">
            <span className="message-edit-hint">Cmd+S to save, Esc to cancel</span>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
