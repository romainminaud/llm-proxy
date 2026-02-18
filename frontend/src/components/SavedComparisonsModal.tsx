import { useState } from 'react'
import type { SavedComparison } from '../types'
import { deleteComparison, renameComparison } from '../utils/savedComparisons'

type SavedComparisonsModalProps = {
  comparisons: SavedComparison[]
  currentComparisonId: string | null
  onLoad: (comparison: SavedComparison) => void
  onClose: () => void
  onUpdate: () => void
}

function SavedComparisonsModal({
  comparisons,
  currentComparisonId,
  onLoad,
  onClose,
  onUpdate,
}: SavedComparisonsModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const handleStartRename = (comp: SavedComparison, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(comp.id)
    setEditName(comp.name)
  }

  const handleSaveRename = (id: string) => {
    if (editName.trim()) {
      renameComparison(id, editName.trim())
      onUpdate()
    }
    setEditingId(null)
    setEditName('')
  }

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('Delete this saved comparison?')) {
      deleteComparison(id)
      onUpdate()
    }
  }

  const handleLoad = (comp: SavedComparison) => {
    onLoad(comp)
    onClose()
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content modal-medium" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Saved Comparisons</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="saved-modal-content">
          {comparisons.length === 0 ? (
            <div className="saved-empty">
              <p>No saved comparisons yet.</p>
              <p className="saved-empty-hint">Save a comparison from the Compare Models dialog to reuse it later.</p>
            </div>
          ) : (
            <div className="saved-list">
              {comparisons.map(comp => (
                <div
                  key={comp.id}
                  className={`saved-item ${comp.id === currentComparisonId ? 'active' : ''}`}
                  onClick={() => handleLoad(comp)}
                >
                  <div className="saved-item-main">
                    {editingId === comp.id ? (
                      <input
                        type="text"
                        className="saved-item-name-input"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveRename(comp.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onBlur={() => handleSaveRename(comp.id)}
                        onClick={e => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span className="saved-item-name">{comp.name}</span>
                    )}
                    <div className="saved-item-details">
                      <span className="saved-item-models">
                        {comp.targets.map(t => t.model).join(', ') || 'No models'}
                      </span>
                      <span className="saved-item-stats">
                        {comp.messages.length} message{comp.messages.length !== 1 ? 's' : ''} · {comp.maxTokens} max tokens
                      </span>
                    </div>
                  </div>
                  <div className="saved-item-meta">
                    <span className="saved-item-date">{formatDate(comp.updatedAt)}</span>
                    <div className="saved-item-actions">
                      <button
                        className="btn-icon-small"
                        onClick={(e) => handleStartRename(comp, e)}
                        title="Rename"
                      >
                        ✏️
                      </button>
                      <button
                        className="btn-icon-small danger"
                        onClick={(e) => handleDelete(comp.id, e)}
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SavedComparisonsModal
