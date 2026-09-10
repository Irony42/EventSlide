import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Spinner } from '../design-system/components/Spinner'
import { fr } from '../lib/i18n/fr'
import { AppShell } from './AppShell'
import { NotFoundView } from './NotFoundView'
import { RequireAuth } from './RequireAuth'
import { GuestJoinPlaceholder, GuestUploadPlaceholder, LoginPlaceholder } from './placeholders'
import styles from './router.module.css'

/**
 * The route table, matching the surfaces in docs/API.md and CLAUDE.md section 1.
 *
 * Exported as routes rather than as a configured router, so a test can mount them
 * inside a `MemoryRouter` and drive the real navigation. `main.tsx` supplies the
 * `BrowserRouter`.
 */

/**
 * The guest surface is loaded eagerly; the host and room surfaces are not.
 *
 * A guest opens this app once, on a phone, on congested venue Wi-Fi, and leaves 40
 * seconds later. Shipping them the moderation console and the slideshow renderer is
 * paid for in exactly the seconds that decide whether they bother sending a photo.
 *
 * Each of these dynamic imports currently resolves to the placeholder module. When a
 * feature folder replaces the placeholder, the import becomes
 * `import('../features/<folder>/<Page>')` and the split is real — the boundary is
 * already here so nobody has to remember to add it.
 */
const WallPage = lazy(async () => ({
  // TODO(feature): features/display
  default: (await import('./placeholders')).WallPlaceholder,
}))

const AdminDashboardPage = lazy(async () => ({
  // TODO(feature): features/admin-dashboard
  default: (await import('./placeholders')).AdminDashboardPlaceholder,
}))

const EventCreatePage = lazy(async () => ({
  // TODO(feature): features/admin-event
  default: (await import('./placeholders')).EventCreatePlaceholder,
}))

const EventDetailPage = lazy(async () => ({
  // TODO(feature): features/admin-event
  default: (await import('./placeholders')).EventDetailPlaceholder,
}))

const ModerationPage = lazy(async () => ({
  // TODO(feature): features/moderation
  default: (await import('./placeholders')).ModerationPlaceholder,
}))

const EventSettingsPage = lazy(async () => ({
  // TODO(feature): features/admin-event
  default: (await import('./placeholders')).EventSettingsPlaceholder,
}))

const ChangePasswordPage = lazy(async () => ({
  // TODO(feature): features/auth
  default: (await import('./placeholders')).ChangePasswordPlaceholder,
}))

const RouteFallback = () => (
  <div className={styles['routeFallback']}>
    <Spinner size="lg" label={fr.app.loading} />
  </div>
)

const GuestLayout = () => (
  <AppShell surface="guest">
    <Outlet />
  </AppShell>
)

const HostLayout = () => (
  <AppShell surface="host">
    <Outlet />
  </AppShell>
)

const WallLayout = () => (
  <AppShell surface="wall">
    <Outlet />
  </AppShell>
)

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* The front door is the guest join screen: it is the only address printed on
            a card, and a host reaching it is one click from /login. */}
        <Route path="/" element={<Navigate to="/join" replace />} />

        <Route element={<GuestLayout />}>
          <Route path="/join" element={<GuestJoinPlaceholder />} />
          {/* A path, not a query string. 1.0 emitted `?partyname=` and read `?party`,
              so every guest silently uploaded to the default event. */}
          <Route path="/join/:code" element={<GuestJoinPlaceholder />} />
          <Route path="/e/:slug/upload" element={<GuestUploadPlaceholder />} />
        </Route>

        {/* Public, and behind no session: a projector has nobody to log it in. */}
        <Route element={<WallLayout />}>
          <Route path="/e/:slug/display" element={<WallPage />} />
        </Route>

        <Route element={<HostLayout />}>
          <Route path="/login" element={<LoginPlaceholder />} />

          <Route element={<RequireAuth />}>
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/events/new" element={<EventCreatePage />} />
            <Route path="/admin/events/:slug" element={<EventDetailPage />} />
            <Route path="/admin/events/:slug/moderation" element={<ModerationPage />} />
            <Route path="/admin/events/:slug/settings" element={<EventSettingsPage />} />
            <Route path="/admin/password" element={<ChangePasswordPage />} />
          </Route>

          {/* Not a redirect to the upload page. See NotFoundView. */}
          <Route path="*" element={<NotFoundView />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
