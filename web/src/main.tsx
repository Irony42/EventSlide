import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './design-system/tokens.css'
import './design-system/base.css'
import { ApiProvider } from './app/ApiProvider'
import { ErrorBoundary } from './app/ErrorBoundary'
import { AppRoutes } from './app/router'
import { ToastProvider } from './design-system/components/ToastProvider'
import { api } from './lib/api/client'

/**
 * The composition root of the web app: the one file that names the real API instance.
 *
 * Import order is load-bearing — tokens first, then the reset that consumes them.
 * Nothing else in the app imports a stylesheet globally.
 */
const container = document.getElementById('root')

if (container === null) {
  throw new Error('#root is missing from index.html; the app has nowhere to mount.')
}

createRoot(container).render(
  <StrictMode>
    {/* Outermost, so a crash inside a provider is still caught and still shows a way
        back rather than a white screen on a projector. */}
    <ErrorBoundary>
      <ApiProvider api={api}>
        <ToastProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
      </ApiProvider>
    </ErrorBoundary>
  </StrictMode>,
)
