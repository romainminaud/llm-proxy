import { Outlet } from 'react-router-dom'
import './App.css'
import ErrorBoundary from './components/ErrorBoundary'
import ReplayModal from './components/ReplayModal'
import SettingsModal from './components/SettingsModal'
import Sidebar from './components/Sidebar'
import { AppProvider, useAppContext } from './context/AppContext'

function AppLayout() {
  const {
    showSettingsModal,
    setShowSettingsModal,
    replayRequest,
    setReplayRequest,
    loadData,
    apiBase,
  } = useAppContext()

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      {replayRequest && (
        <ErrorBoundary fallback={<div className="error-banner">Failed to render replay modal</div>}>
          <ReplayModal
            request={replayRequest}
            apiBase={apiBase}
            onClose={() => setReplayRequest(null)}
            onSuccess={() => {
              setReplayRequest(null)
              loadData()
            }}
          />
        </ErrorBoundary>
      )}

      {showSettingsModal && (
        <ErrorBoundary fallback={<div className="error-banner">Failed to render settings modal</div>}>
          <SettingsModal
            apiBase={apiBase}
            onClose={() => setShowSettingsModal(false)}
          />
        </ErrorBoundary>
      )}
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppLayout />
      </AppProvider>
    </ErrorBoundary>
  )
}

export default App
