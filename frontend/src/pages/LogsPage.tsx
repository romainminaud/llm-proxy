import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Controls from '../components/Controls'
import ErrorBoundary from '../components/ErrorBoundary'
import RequestDetail from '../components/RequestDetail'
import RequestsTable from '../components/RequestsTable'
import StatsCards from '../components/StatsCards'
import { useAppContext } from '../context/AppContext'
import type { RequestRecord } from '../types'

export default function LogsPage() {
  const {
    requests,
    stats,
    displayStats,
    selectedIds,
    selectedRequests,
    modelFilter,
    setModelFilter,
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    priceMultiplier,
    setPriceMultiplier,
    setShowSettingsModal,
    setReplayRequest,
    loadData,
    clearAll,
    toggleSelect,
    toggleSelectAll,
    exportSelectedCsv,
    exportSelectedStatsCsv,
    apiBase,
    autoRefreshMs,
  } = useAppContext()

  const navigate = useNavigate()
  const [selectedRequest, setSelectedRequest] = useState<RequestRecord | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyId = async (id: string) => {
    if (!id) return
    try {
      await navigator.clipboard.writeText(id)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(null), 1500)
    } catch {
      window.prompt('Copy ID:', id)
    }
  }

  const handleCompareRequest = (request: RequestRecord) => {
    // Store request in sessionStorage for the compare page to pick up
    sessionStorage.setItem('compareRequest', JSON.stringify(request))
    navigate('/compare')
  }

  return (
    <div className="logs-page">
      <h1 className="page-title">Request Logs</h1>

      <StatsCards
        stats={displayStats}
        selectionCount={selectedIds.size}
        priceMultiplier={priceMultiplier}
      />

      <Controls
        modelFilter={modelFilter}
        stats={stats}
        onModelFilterChange={setModelFilter}
        onRefresh={loadData}
        onClearAll={clearAll}
        onSettings={() => setShowSettingsModal(true)}
        autoRefreshEnabled={autoRefreshEnabled}
        autoRefreshMs={autoRefreshMs}
        onAutoRefreshChange={setAutoRefreshEnabled}
        selectedCount={selectedRequests.length}
        onExportSelected={exportSelectedCsv}
        onExportSelectedStats={exportSelectedStatsCsv}
        priceMultiplier={priceMultiplier}
        onPriceMultiplierChange={setPriceMultiplier}
      />

      <ErrorBoundary fallback={<div className="error-banner">Failed to load requests table</div>}>
        <RequestsTable
          requests={requests}
          onSelect={setSelectedRequest}
          onReplay={setReplayRequest}
          onCompare={handleCompareRequest}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          priceMultiplier={priceMultiplier}
        />
      </ErrorBoundary>

      {selectedRequest && (
        <div className="modal" onClick={() => setSelectedRequest(null)}>
          <div className="modal-content modal-large" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Request Details</h3>
              <button className="close-btn" onClick={() => setSelectedRequest(null)}>&times;</button>
            </div>
            <ErrorBoundary fallback={<div className="error-banner">Failed to render request details</div>}>
              <RequestDetail
                request={selectedRequest}
                apiBase={apiBase}
                onCopyId={copyId}
                copiedId={copiedId}
              />
            </ErrorBoundary>
          </div>
        </div>
      )}
    </div>
  )
}
