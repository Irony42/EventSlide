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
import { resolveOfflineQueue } from './lib/offline/killSwitch'
import { registerUploadWorker, removeUploadWorker } from './lib/offline/serviceWorker'

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

/**
 * The upload worker, or its removal.
 *
 * The switch is read on every build, and only the *registration* is gated on a
 * production bundle. `/sw.js` is emitted by `web/vite.sw.config.ts` during
 * `npm run build`, so the dev server has nothing to serve and registering there would
 * fail on every reload — but `?offline=off` still has to work in development, because
 * the queue itself runs there (over the in-memory fallback) and a developer holding a
 * misbehaving build is exactly who needs to turn it off.
 *
 * The "off" path is not a no-op, and that is the point of having it: it unregisters a
 * worker already installed on the guest's phone and deletes the photos it was holding.
 * A kill switch that only stopped new installations would leave the bad build running
 * on exactly the devices it was breaking.
 *
 * The end-to-end suite runs against the built client, so it exercises the real
 * registration rather than a branch nothing takes.
 */
if (resolveOfflineQueue(window.location.search)) {
  if (import.meta.env.PROD) void registerUploadWorker()
} else {
  void removeUploadWorker()
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
