import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App'
import LogsPage from './pages/LogsPage'
import ComparisonsPage from './pages/ComparisonsPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/logs" replace /> },
      { path: 'logs', element: <LogsPage /> },
      { path: 'compare', element: <ComparisonsPage /> },
      { path: 'compare/:id', element: <ComparisonsPage /> },
    ],
  },
])

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
