import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Spinner } from '../design-system/components/Spinner'
import { fr } from '../lib/i18n/fr'
import { GuestUploadPage } from '../features/guest-upload/GuestUploadPage'
import { JoinPage } from '../features/join/JoinPage'
import { AppShell } from './AppShell'
import { NotFoundView } from './NotFoundView'
import { RequireAuth } from './RequireAuth'
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
 */
const WallPage = lazy(async () => ({
  default: (await import('../features/wall/WallPage')).WallPage,
}))

/**
 * The login form is lazy too, even though it is the host's first screen.
 *
 * It is only ever reached deliberately, and keeping it out of the initial chunk keeps
 * the guest surface — which shares that chunk — as small as it can be.
 */
const LoginPage = lazy(async () => ({
  default: (await import('../features/auth/LoginPage')).LoginPage,
}))

const AdminDashboardPage = lazy(async () => ({
  default: (await import('../features/admin/DashboardPage')).DashboardPage,
}))

const EventCreatePage = lazy(async () => ({
  default: (await import('../features/admin/NewEventPage')).NewEventPage,
}))

const EventDetailPage = lazy(async () => ({
  default: (await import('../features/admin/EventPage')).EventPage,
}))

const ModerationPage = lazy(async () => ({
  default: (await import('../features/moderation/ModerationPage')).ModerationPage,
}))

/**
 * The same queue, for a host who is standing up with a phone in one hand.
 *
 * Its own chunk rather than a branch inside the console: the two screens share their
 * hooks and nothing else, and a host who only ever opens one of them should not be
 * downloading the other's grid, lightbox and keyboard layer over a venue's Wi-Fi.
 */
const MobileModerationPage = lazy(async () => ({
  default: (await import('../features/moderation/MobileModerationPage')).MobileModerationPage,
}))

const EventSettingsPage = lazy(async () => ({
  default: (await import('../features/admin/EventSettingsPage')).EventSettingsPage,
}))

const ChangePasswordPage = lazy(async () => ({
  default: (await import('../features/auth/ChangePasswordPage')).ChangePasswordPage,
}))

/**
 * The second gate, inside `RequireAuth`.
 *
 * A moderator invited by a host arrives with a password somebody else chose for them;
 * until they replace it, every admin address leads to the change-password screen.
 */
const MustChangePasswordGate = lazy(async () => ({
  default: (await import('../features/auth/MustChangePasswordGate')).MustChangePasswordGate,
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
          <Route path="/join" element={<JoinPage />} />
          {/* A path, not a query string. 1.0 emitted `?partyname=` and read `?party`,
              so every guest silently uploaded to the default event. */}
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="/e/:slug/upload" element={<GuestUploadPage />} />
        </Route>

        {/* Public, and behind no session: a projector has nobody to log it in. */}
        <Route element={<WallLayout />}>
          <Route path="/e/:slug/display" element={<WallPage />} />
        </Route>

        <Route element={<HostLayout />}>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<MustChangePasswordGate />}>
              <Route path="/admin" element={<AdminDashboardPage />} />
              <Route path="/admin/events/new" element={<EventCreatePage />} />
              <Route path="/admin/events/:slug" element={<EventDetailPage />} />
              <Route path="/admin/events/:slug/moderation" element={<ModerationPage />} />
              {/* Beside the console rather than instead of it: the host chooses the
                  surface by choosing the address, and a phone-shaped screen is a
                  different screen, not a narrow one. */}
              <Route
                path="/admin/events/:slug/moderation/mobile"
                element={<MobileModerationPage />}
              />
              <Route path="/admin/events/:slug/settings" element={<EventSettingsPage />} />
              <Route path="/admin/password" element={<ChangePasswordPage />} />
            </Route>
          </Route>

          {/* Not a redirect to the upload page. See NotFoundView. */}
          <Route path="*" element={<NotFoundView />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
