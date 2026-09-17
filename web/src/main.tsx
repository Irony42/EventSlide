import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './design-system/tokens.css'
import './design-system/base.css'
import { ApiProvider } from './app/ApiProvider'
import { ErrorBoundary } from './app/ErrorBoundary'
import { AppRoutes } from './app/router'
import { api } from './lib/api/client'
import { LocaleProvider } from './lib/i18n/LocaleProvider'
import { resolveOfflineQueue } from './lib/offline/killSwitch'
import { watchForInstall } from './lib/pwa/install'
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

/**
 * Started before anything renders, and that placement is the feature.
 *
 * `beforeinstallprompt` fires once per document load. A guest goes `/join/:code` then
 * `navigate` to `/e/:slug/upload` — one document — so Chromium fires it while the join
 * screen is up, long before the upload screen that wants it exists. Listening from a
 * component means never hearing it.
 */
watchForInstall()

createRoot(container).render(
  <StrictMode>
    {/* Above the crash boundary, and only for that: the boundary is the one screen a
        guest can reach that no layout owns, and "nothing is lost, your photos are on the
        server" is worth nothing in a language they do not read. It holds no state a
        crash could corrupt — a locale and a lookup table — so putting it outside costs
        nothing the boundary was protecting.

        What this boundary cannot do is speak French to the other two audiences. It reads
        the locale where it sits, which is above the route table and therefore above every
        FrenchSurface, so a crash under /admin or /e/:slug/display would render here in
        the guest's language — on a console, or on a projector with a room in front of it.
        That is why HostLayout and WallLayout each carry a boundary of their own, inside
        their FrenchSurface, and catch first. This one covers what is left: the guest
        surface, and anything that fails above the router. */}
    <LocaleProvider>
      {/* Outermost of the rest, so a crash inside a provider is still caught and still
          shows a way back rather than a white screen on a projector. */}
      <ErrorBoundary>
        <ApiProvider api={api}>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ApiProvider>
      </ErrorBoundary>
    </LocaleProvider>
  </StrictMode>,
)
