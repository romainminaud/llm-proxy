import { useState, useEffect } from 'react'
import type { ProviderInfo } from '../types'
import { loadApiKeys, saveApiKeys, clearApiKeys } from '../utils/apiKeys'

type SettingsModalProps = {
  apiBase: string
  onClose: () => void
}

function SettingsModal({ apiBase, onClose }: SettingsModalProps) {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => loadApiKeys())
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const res = await fetch(`${apiBase}/api/providers`)
        if (res.ok) {
          const data = await res.json() as Record<string, ProviderInfo>
          setProviders(data)
        }
      } catch {
        // ignore
      }
    }
    fetchProviders()
  }, [apiBase])

  const handleApiKeyChange = (provider: string, value: string) => {
    const updated = { ...apiKeys, [provider]: value }
    setApiKeys(updated)
    saveApiKeys(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const handleClearAll = () => {
    if (window.confirm('Clear all saved API keys?')) {
      clearApiKeys()
      setApiKeys({})
    }
  }

  const providerNames = Object.keys(providers)

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content modal-small" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <div className="settings-section-header">
              <h4>API Keys</h4>
              <span className="settings-hint">Stored locally in your browser</span>
            </div>
            <p className="settings-description">
              Configure API keys for each provider. Keys are used for replaying requests and model comparisons.
            </p>
            <div className="api-keys-list">
              {providerNames.map(name => (
                <div key={name} className="api-key-row">
                  <label>{name.charAt(0).toUpperCase() + name.slice(1)}</label>
                  <input
                    type="password"
                    value={apiKeys[name] || ''}
                    onChange={e => handleApiKeyChange(name, e.target.value)}
                    placeholder={providers[name]?.replayApiKeyPlaceholder || 'Enter API key...'}
                  />
                  {apiKeys[name] && (
                    <span className="key-status">Set</span>
                  )}
                </div>
              ))}
            </div>
            {saved && <div className="save-indicator">Saved</div>}
          </div>

          <div className="settings-actions">
            <button className="btn-secondary" onClick={handleClearAll}>
              Clear All Keys
            </button>
            <button className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
