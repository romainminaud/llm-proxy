import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ComparisonEditor from '../components/ComparisonEditor'
import { useAppContext } from '../context/AppContext'
import type { SavedComparison, RequestRecord } from '../types'
import { loadSavedComparisons, deleteComparison, renameComparison, getComparison } from '../utils/savedComparisons'

export default function ComparisonsPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const { setShowSettingsModal } = useAppContext()

  const [savedComparisons, setSavedComparisons] = useState<SavedComparison[]>([])
  const [currentComparison, setCurrentComparison] = useState<SavedComparison | null>(null)
  const [initialRequest, setInitialRequest] = useState<RequestRecord | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Load saved comparisons
  useEffect(() => {
    setSavedComparisons(loadSavedComparisons())
  }, [])

  // Handle URL param or sessionStorage request
  useEffect(() => {
    // Check for initial request from logs page
    const storedRequest = sessionStorage.getItem('compareRequest')
    if (storedRequest) {
      sessionStorage.removeItem('compareRequest')
      setInitialRequest(JSON.parse(storedRequest) as RequestRecord)
      setCurrentComparison(null)
      return
    }

    // Load comparison from URL
    if (id) {
      const comparison = getComparison(id)
      if (comparison) {
        setCurrentComparison(comparison)
        setInitialRequest(null)
      } else {
        // Comparison not found, redirect to base compare page
        navigate('/compare', { replace: true })
      }
    } else {
      // Only clear currentComparison when navigating to /compare without id
      // Don't clear initialRequest here - it may have been set from sessionStorage
      setCurrentComparison(null)
    }
  }, [id, navigate])

  const handleNewComparison = () => {
    setCurrentComparison(null)
    setInitialRequest(null)
    navigate('/compare')
  }

  const handleSelectComparison = (comparison: SavedComparison) => {
    setCurrentComparison(comparison)
    setInitialRequest(null)
    navigate(`/compare/${comparison.id}`)
  }

  const handleSaveComparison = (saved: SavedComparison) => {
    setSavedComparisons(loadSavedComparisons())
    setCurrentComparison(saved)
    navigate(`/compare/${saved.id}`, { replace: true })
  }

  const handleDeleteComparison = (compId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm('Delete this comparison?')) return
    deleteComparison(compId)
    setSavedComparisons(loadSavedComparisons())
    if (currentComparison?.id === compId) {
      setCurrentComparison(null)
      navigate('/compare')
    }
  }

  const startRename = (comp: SavedComparison, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(comp.id)
    setEditingName(comp.name)
  }

  const saveRename = (compId: string) => {
    if (editingName.trim()) {
      renameComparison(compId, editingName.trim())
      setSavedComparisons(loadSavedComparisons())
    }
    setEditingId(null)
    setEditingName('')
  }

  const cancelRename = () => {
    setEditingId(null)
    setEditingName('')
  }

  return (
    <div className={`comparisons-page ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Left Sidebar - Saved Comparisons */}
      <div className={`comparisons-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="comparisons-sidebar-header">
          {!sidebarCollapsed && <h2>Comparisons</h2>}
          <div className="sidebar-header-actions">
            {!sidebarCollapsed && (
              <button className="btn-new" onClick={handleNewComparison}>+ New</button>
            )}
            <button
              className="btn-collapse"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? '»' : '«'}
            </button>
          </div>
        </div>
        {!sidebarCollapsed && (
          <div className="comparisons-list">
            {savedComparisons.length === 0 ? (
              <div className="no-comparisons">
                No saved comparisons yet.
                <br />
                Create one to get started.
              </div>
            ) : (
              savedComparisons.map(comp => (
                <div
                  key={comp.id}
                  className={`comparison-list-item ${comp.id === currentComparison?.id ? 'active' : ''}`}
                  onClick={() => handleSelectComparison(comp)}
                >
                  {editingId === comp.id ? (
                    <div className="comparison-rename-input" onClick={e => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveRename(comp.id)
                          if (e.key === 'Escape') cancelRename()
                        }}
                        autoFocus
                      />
                      <button onClick={() => saveRename(comp.id)}>Save</button>
                      <button onClick={cancelRename}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="comparison-list-item-info">
                        <span className="comparison-list-item-name">{comp.name}</span>
                        <span className="comparison-list-item-meta">
                          {comp.targets.length} model{comp.targets.length !== 1 ? 's' : ''} · {comp.messages.length} msg{comp.messages.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="comparison-list-item-actions">
                        <button
                          className="btn-icon-small"
                          onClick={(e) => startRename(comp, e)}
                          title="Rename"
                        >
                          ✏️
                        </button>
                        <button
                          className="btn-icon-small"
                          onClick={(e) => handleDeleteComparison(comp.id, e)}
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Main Content - Editor */}
      <div className="comparisons-main">
        <ComparisonEditor
          comparison={currentComparison}
          initialRequest={initialRequest}
          onSave={handleSaveComparison}
          onOpenSettings={() => setShowSettingsModal(true)}
        />
      </div>
    </div>
  )
}
