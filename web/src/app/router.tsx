import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Spinner } from '../design-system/components/Spinner'
import { ToastProvider } from '../design-system/components/ToastProvider'
import { DeferredLocale } from '../lib/i18n/LocaleProvider'
import { useTranslations } from '../lib/i18n/useTranslations'
import { GuestUploadPage } from '../features/guest-upload/GuestUploadPage'
import { JoinPage } from '../features/join/JoinPage'
import { AppShell } from './AppShell'
import { ErrorBoundary } from './ErrorBoundary'
import { glassBackdropFor } from './glassBackdrop'
import { LanguagePicker } from './LanguagePicker'
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

/**
 * The loader between two lazy chunks.
 *
 * Reads the active table rather than importing French, so it says the right word wherever
 * it is mounted — and it is mounted twice over, which is the point of the pair of
 * `Suspense` boundaries below. The inner one, inside each layout, is the one a host or a
 * room actually sees: it is under that surface's locale, under its error boundary and
 * inside its shell, so a wall waiting for its chunk shows the room a spinner labelled in
 * the event's language. The outer one is a backstop for anything that could suspend above
 * a layout, where the reader's own language is the only one in scope and is the right
 * answer.
 */
const RouteFallback = () => {
  const text = useTranslations()
  return (
    <div className={styles['routeFallback']}>
      <Spinner size="lg" label={text.app.loading} />
    </div>
  )
}

/**
 * Which glass tier the address under a layout may claim — roadmap 11.2.
 *
 * Read in the layout rather than passed up from a page, because a layout is the innermost
 * thing that renders the shell and the shell is where the tier reaches the DOM. Reading the
 * location is what lets one layout serve several addresses with different answers: the
 * guest's join screen can afford the translucent tier and their upload screen cannot, and
 * both are the same layout with the same toast region — so splitting them into two layouts
 * would remount the shell in the middle of the guest's critical path to change a custom
 * property.
 *
 * The table and the walk that checks it are in `glassBackdrop.ts`.
 */
const useGlassBackdrop = () => glassBackdropFor(useLocation().pathname)

/**
 * The guest surface, with the language picker in its header.
 *
 * Here rather than inside `JoinPage` and `GuestUploadPage`, because it belongs to both
 * and to nothing else: a feature folder never imports from another feature, and the
 * layout is the one place that already knows "these routes are the guest's".
 *
 * **`ToastProvider` is inside each layout and not above the router**, and that placement
 * is a correctness fix rather than tidying. The toast region is rendered by the provider
 * itself, and `Toast` reads its own copy from the active table — so a provider above the
 * router renders one region for three surfaces that no longer agree about language. The
 * wall is the survivor of that argument: it is the event's language, the toast that
 * covers it would be the projector operator's, and the dismiss control inside an
 * otherwise German panel would read "Masquer cette notification". Inside the layout, the
 * region is in the same language as the screen that raised it, whichever screen that is.
 */
const GuestLayout = () => {
  const backdrop = useGlassBackdrop()
  return (
    <ToastProvider>
      <AppShell surface="guest" backdrop={backdrop} header={<LanguagePicker />}>
        <Outlet />
      </AppShell>
    </ToastProvider>
  )
}

/**
 * The host console, in the host's own language.
 *
 * It re-provides nothing. This layout used to wrap everything under it in a
 * `FrenchSurface`, because the admin and moderation copy was French in every language and
 * a shared primitive reading the active table would otherwise have put an English "Cancel"
 * inside a French dialog. Every section is translated now, so a host reading their console
 * in the language they set on their phone is the feature rather than the hazard, and the
 * boundary would be the defect — `translations.ts` has the argument that changed.
 *
 * **The language picker is in the header, exactly as it is for the guest**, and that is
 * the other half of the same decision: a host is a person with a browser, so the signal
 * that works for a guest works for them. It matters most for the reader the old argument
 * forgot — a moderator invited by e-mail, handed a temporary password and a phone at
 * 21:00, who never installed anything and has no reason to read French.
 *
 * **The `ErrorBoundary` stays, and it is still not belt-and-braces.** Every screen under
 * this layout is a lazily loaded chunk, so a host who left a tab open across a deploy gets
 * a loader rejection as a matter of course — that is the failure the lazy split buys and
 * has to pay for. Catching it here rather than in `main.tsx` keeps the crash screen inside
 * this layout's shell and toast region instead of replacing the whole document.
 *
 * **`ToastProvider` is inside the layout and not above the router** for the reason
 * `GuestLayout` states: the provider renders the toast region, and the region has to be
 * inside whatever locale the screen that raised the toast is in. That was a correctness
 * fix when the surfaces disagreed about language, and it is still one — the wall
 * disagrees with both.
 */
const HostLayout = () => {
  const backdrop = useGlassBackdrop()
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppShell surface="host" backdrop={backdrop} header={<LanguagePicker />}>
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </AppShell>
      </ToastProvider>
    </ErrorBoundary>
  )
}

/**
 * The projected wall, in the language the **event** is set to.
 *
 * The one surface with nobody in front of it to ask, and therefore the one that is told
 * rather than asked: `wallLanguage` is a setting on the event, defaulted once to the
 * language of whoever created it, and it arrives on the wall response.
 * `src/domain/events/eventLanguage.ts` carries that argument and
 * `lib/i18n/deferredLocale.ts` carries the mechanical half — the language lands a round
 * trip after this shell has rendered, so `WallPage` announces it upward and
 * `DeferredLocale` holds it for `AppShell`, which is what puts it on `<html lang>`.
 *
 * Nothing here reads `navigator.languages`, and that is the whole point: on a projector
 * that is the language of whichever machine the venue had in a cupboard.
 *
 * **The wall passes no backdrop, and that is not an omission.** The room takes the opaque
 * tier from the surface rule whatever is behind a pane, so a backdrop here would be a
 * value with no consequence — and a value with no consequence is one somebody later reads
 * as a decision. `glassBackdrop.ts` still records the wall's real answer, where it costs
 * nothing and stays true.
 */
const WallLayout = () => (
  <DeferredLocale>
    <ErrorBoundary>
      <ToastProvider>
        <AppShell surface="wall">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </AppShell>
      </ToastProvider>
    </ErrorBoundary>
  </DeferredLocale>
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
          {/* The guest's own dead ends, answered on the guest's own surface.
              A card printed against an older URL shape, a link forwarded through a
              group chat, a path that gained a segment: the reader is holding a phone
              and may not read French, and "this address does not exist, go here
              instead" is the whole value of the screen. The host catch-all below still
              answers everything else, in French and at host width, which is right for a
              mistyped `/admin` address. */}
          <Route path="/join/*" element={<NotFoundView />} />
          <Route path="/e/*" element={<NotFoundView />} />
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
