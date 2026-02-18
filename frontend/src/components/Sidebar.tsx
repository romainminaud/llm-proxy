import { NavLink } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'

export default function Sidebar() {
  const { setShowSettingsModal } = useAppContext()

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">LLM Proxy</h1>
      </div>
      <nav className="sidebar-nav">
        <NavLink
          to="/logs"
          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
        >
          <span className="sidebar-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <line x1="5" y1="6" x2="11" y2="6" />
              <line x1="5" y1="8.5" x2="11" y2="8.5" />
              <line x1="5" y1="11" x2="8" y2="11" />
            </svg>
          </span>
          <span>Logs</span>
        </NavLink>
        <NavLink
          to="/compare"
          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
        >
          <span className="sidebar-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="3" width="5" height="10" rx="1" />
              <rect x="9.5" y="3" width="5" height="10" rx="1" />
              <line x1="8" y1="5" x2="8" y2="11" strokeDasharray="1.5 1.5" />
            </svg>
          </span>
          <span>Compare</span>
        </NavLink>
      </nav>
      <div className="sidebar-footer">
        <button
          className="sidebar-link sidebar-button"
          onClick={() => setShowSettingsModal(true)}
        >
          <span className="sidebar-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="2.5" />
              <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
            </svg>
          </span>
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}
