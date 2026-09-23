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

/**
 * The shared gallery (roadmap §4.1): a guest surface, and lazy all the same. The person
 * who opens it is not standing at the venue on its Wi-Fi with a photo to send — they are
 * at home the next week — so the guest's own eager chunk does not pay for it.
 */
const GalleryPage = lazy(async () => ({
  default: (await import('../features/gallery/GalleryPage')).GalleryPage,
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
 * The loader between two lazy chunks, mounted twice over — which is the point of the pair
 * of `Suspense` boundaries below. The inner one, inside each layout, is under that
 * surface's locale, so a wall waiting for its chunk is labelled in the event's language.
 * The outer one is a backstop for anything suspending above a layout, where the reader's
 * own language is the only one in scope.
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
 * The picker is here rather than inside `JoinPage` and `GuestUploadPage` because it
 * belongs to both and to nothing else: a feature folder never imports from another.
 *
 * **`ToastProvider` is inside each layout and not above the router**, which is a
 * correctness fix rather than tidying. The provider renders the toast region and `Toast`
 * reads the active table, so one region above the router would serve three surfaces that
 * disagree about language — a French dismiss control inside an otherwise German wall
 * panel, decided by whoever plugged the projector in.
 * `router.test.tsx > the toast region` guards it by driving a real toast.
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
 * The loader and the crash screen for the one lazy page under the guest layout.
 *
 * The guest's own pages are eager, so `GuestLayout` has neither; without this the shared
 * gallery's chunk would suspend all the way up to the router's outer boundary and take the
 * shell — header, language picker and all — off the screen while it loads, and a chunk
 * that failed after a deploy would have no boundary to land in at all.
 */
const LazyGuestPage = () => (
  <ErrorBoundary>
    <Suspense fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  </ErrorBoundary>
)

/**
 * The host console, in the host's own language, re-providing nothing.
 *
 * It used to wrap everything under it in a `FrenchSurface`; a host reading their console
 * in the language they set on their phone is the feature now rather than the hazard, and
 * that boundary would be the defect. `translations.ts` has the argument that changed, and
 * the picker in the header is its other half — a host is a person with a browser, and the
 * reader that argument forgot is a moderator handed a phone at 21:00.
 *
 * **The `ErrorBoundary` stays, for a reason that is not about language.** Every screen
 * here is a lazy chunk, so a host who left a tab open across a deploy gets a loader
 * rejection as a matter of course; catching it here keeps the crash screen inside this
 * layout's shell instead of replacing the document.
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
 * Nothing here reads `navigator.languages`, which is the whole point: on a projector that
 * is the language of whichever machine the venue had in a cupboard.
 * `src/domain/events/eventLanguage.ts` has the argument, `lib/i18n/deferredLocale.ts` the
 * mechanics of a language that arrives a round trip after this shell renders.
 *
 * **The wall passes no backdrop, and that is not an omission.** The room takes the opaque
 * tier whatever is behind a pane, so a backdrop here would be a value with no consequence
 * — and one somebody later reads as a decision. `glassBackdrop.ts` records the real answer.
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
          {/* The shared gallery. The token is a path segment, like the join code, and it
              is the whole credential: nothing here signs anybody in. */}
          <Route element={<LazyGuestPage />}>
            <Route path="/g/:token" element={<GalleryPage />} />
          </Route>
          <Route path="/g/*" element={<NotFoundView />} />
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
