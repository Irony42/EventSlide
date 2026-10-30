import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { PageTitle } from '../design-system/components/PageTitle'
import { Spinner } from '../design-system/components/Spinner'
import { ToastProvider } from '../design-system/components/ToastProvider'
import { DeferredLocale } from '../lib/i18n/LocaleProvider'
import { useAbout, useAboutAnswered } from './useAbout'
import type { UiText } from '../lib/i18n/translations'
import { useTranslations } from '../lib/i18n/useTranslations'
import { GuestFeedPage } from '../features/guest-feed/GuestFeedPage'
import { GuestUploadPage } from '../features/guest-upload/GuestUploadPage'
import { JoinPage } from '../features/join/JoinPage'
import { AppShell } from './AppShell'
import { AccountMenu } from './AccountMenu'
import { ErrorBoundary } from './ErrorBoundary'
import { LanguagePicker } from './LanguagePicker'
import { HostNotFoundView, NotFoundView } from './NotFoundView'
import { RequireAuth } from './RequireAuth'
import { RequireOperator } from './RequireOperator'
import { SessionExpiredBanner } from './SessionExpiredBanner'
import { SessionProvider } from './SessionProvider'
import { SiteFooter } from './SiteFooter'
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

const CustomAmbiancePage = lazy(async () => ({
  default: (await import('../features/admin/CustomAmbiancePage')).CustomAmbiancePage,
}))

/**
 * The shared gallery (roadmap §4.1): a guest surface, and lazy all the same. The person
 * who opens it is not standing at the venue on its Wi-Fi with a photo to send — they are
 * at home the next week — so the guest's own eager chunk does not pay for it.
 */
const GalleryPage = lazy(async () => ({
  default: (await import('../features/gallery/GalleryPage')).GalleryPage,
}))

/**
 * `/about`: the version, the licence and the source (roadmap G1-04). Lazy because nobody
 * needs it while photographing a party; it is the long form of the footer's one-line offer.
 */
const AboutPage = lazy(async () => ({
  default: (await import('../features/about/AboutPage')).AboutPage,
}))

/**
 * The client's own space (G2-16 / P3-17): lazy, and registered only on a box that has one.
 */
const ClientSpacePage = lazy(async () => ({
  default: (await import('../features/admin/ClientSpacePage')).ClientSpacePage,
}))

/**
 * The operator's console (G2-15 / P3-16): five lazy chunks, registered only on a box that has one.
 * A guest, and a host who is not the operator, never download a line of it.
 */
const SiteLayout = lazy(async () => ({
  default: (await import('../features/site/SiteLayout')).SiteLayout,
}))
const SiteClientsPage = lazy(async () => ({
  default: (await import('../features/site/ClientsPage')).ClientsPage,
}))
const SiteClientPage = lazy(async () => ({
  default: (await import('../features/site/ClientPage')).ClientPage,
}))
const SiteAccountsPage = lazy(async () => ({
  default: (await import('../features/site/AccountsPage')).AccountsPage,
}))
const SiteAuditPage = lazy(async () => ({
  default: (await import('../features/site/AuditPage')).AuditPage,
}))

const DeleteAccountPage = lazy(async () => ({
  default: (await import('../features/auth/DeleteAccountPage')).DeleteAccountPage,
}))
const ChangePasswordPage = lazy(async () => ({
  default: (await import('../features/auth/ChangePasswordPage')).ChangePasswordPage,
}))

const SecurityPage = lazy(async () => ({
  default: (await import('../features/auth/SecurityPage')).SecurityPage,
}))

/**
 * The second gate, inside `RequireAuth`: an account with `mustChangePassword` set reaches
 * the change-password screen from every admin address until it has replaced its password.
 */
const MustChangePasswordGate = lazy(async () => ({
  default: (await import('../features/auth/MustChangePasswordGate')).MustChangePasswordGate,
}))

/**
 * The pages a link opens: an invitation (G2-09), and the two halves of a forgotten password
 * (G2-08). Lazy for the reason the sign-in form is (nobody needs them while photographing a
 * party) and **none of them behind `RequireAuth`**: the person who opens one has no session,
 * and the link or the form is the whole credential.
 */
const AcceptInvitationPage = lazy(async () => ({
  default: (await import('../features/auth/AcceptInvitationPage')).AcceptInvitationPage,
}))
const ForgotPasswordPage = lazy(async () => ({
  default: (await import('../features/auth/ForgotPasswordPage')).ForgotPasswordPage,
}))
const ResetPasswordPage = lazy(async () => ({
  default: (await import('../features/auth/ResetPasswordPage')).ResetPasswordPage,
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
 * Whether the host footer may offer "Soutenir le projet" (roadmap G4-02) and the operator's
 * help page (G2-17) at this address: `/login` and `/admin/**`, the host's own screens, and
 * nothing else.
 *
 * Read from the address rather than assumed from the layout, because `HostLayout` also
 * answers the router's catch-all. A guest holding a card printed against an older address
 * shape — 1.0's `/upload?partyname=…` is outside `/join/*`, `/e/*` and `/g/*` — lands on that
 * not-found screen under the host's footer, and a guest is not who is being asked. The
 * source offer is not subject to this: it belongs on every screen that has a footer.
 */
const useSignedInArea = (): boolean => {
  const { pathname } = useLocation()
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

const useHostScreen = (): boolean => {
  const { pathname } = useLocation()
  return pathname === '/login' || pathname === '/admin' || pathname.startsWith('/admin/')
}

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
  return (
    <ToastProvider>
      <AppShell
        surface="guest"
        header={<LanguagePicker />}
        // The one footer that may carry "Signaler un contenu" (roadmap G2-17 / P3-18, DSA art.
        // 16): these are the screens where a stranger meets other people's photographs.
        footer={<SiteFooter reportLink />}
      >
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
  <ErrorBoundary surface="guest" resetKey={useLocation().pathname}>
    <Suspense fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  </ErrorBoundary>
)

/**
 * `/e/:slug` with nothing after it: the event's front door, sent to the page a guest uses.
 *
 * A link shortened by hand or a card that lost its last segment used to end on "page not found".
 * The upload page is the guest's main screen (the join lands there), and it asks for the code
 * itself when the phone holds no session for the event. `/e/:slug/photos` and `/display` are
 * reached from the event, never guessed.
 */
const EventFrontDoor = () => {
  const { slug } = useParams()
  return <Navigate to={`/e/${encodeURIComponent(slug ?? '')}/upload`} replace />
}

/**
 * The host layout's header: the picker, and the account menu where there is an account.
 *
 * The menu is mounted on `/admin/**` and nowhere else, which is the signed-in area by
 * construction (`RequireAuth` guards exactly that subtree). Mounting it there rather than on
 * every host screen means it appears on arrival and goes with the sign-out's navigation,
 * with no state to keep in step with a login that happened on a sibling route.
 */
const HostHeader = () => {
  const signedInArea = useSignedInArea()
  return (
    <div className={styles['hostHeader']}>
      <LanguagePicker />
      {signedInArea ? <AccountMenu /> : null}
    </div>
  )
}

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
  const hostScreen = useHostScreen()
  const signedInArea = useSignedInArea()
  const { pathname } = useLocation()
  return (
    <ErrorBoundary surface="host" resetKey={pathname}>
      <ToastProvider>
        {/* Around the shell and not inside the gate: the account menu in the header and the
            gates under the outlet read the same answer, and that is the whole point. */}
        <SessionProvider scope={signedInArea ? 'signed-in' : 'open'}>
          <AppShell
            surface="host"
            header={<HostHeader />}
            // The one footer that may carry "Soutenir le projet" (roadmap G4-02) and the
            // operator's help page (G2-17), and only on the host's own screens: nobody on them
            // is mid-upload or in front of the room.
            footer={<SiteFooter supportLink={hostScreen} helpLink={hostScreen} />}
          >
            {/* Where the session's end is shown: over the page, which stays (decision 6). */}
            {signedInArea ? <SessionExpiredBanner /> : null}
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </AppShell>
        </SessionProvider>
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
 */
const WallLayout = () => (
  <DeferredLocale>
    {/* `surface="wall"`: no link home, and it tries again by itself after a crash, because
        nobody is in front of the projector to press "Réessayer". */}
    <ErrorBoundary surface="wall">
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

/**
 * A page, named in the browser tab (WCAG 2.4.2).
 *
 * The title is declared here, beside the address it belongs to, and not inside each page:
 * a screen mounted from four addresses (the not-found one) carries no title of its own, a
 * page with six states (the invitation) needs one in none of them, and a reader of this table
 * sees every tab name together. It sits inside the layout, so the title is in the language
 * that layout speaks: the event's, on the wall, once its response has said which.
 *
 * `pageTitles.test.tsx` mounts every address and holds this table to `fr.titles`.
 */
const TabTitle = ({ page }: { readonly page: keyof UiText['titles'] }) => {
  const t = useTranslations()
  return <PageTitle title={t.titles[page]} />
}

const titled = (page: keyof UiText['titles'], element: ReactNode): ReactNode => (
  <>
    <TabTitle page={page} />
    {element}
  </>
)

export function AppRoutes() {
  // Read once the box has said so: with `SITE_ADMIN=off` there is no client space, so no route is
  // registered and a direct visit to its address is the not-found screen, as for any address
  // nobody wrote (G2-00 / P3-21).
  const siteAdmin = useAbout().features.siteAdmin
  const aboutAnswered = useAboutAnswered()
  const { pathname } = useLocation()
  // The console's addresses exist only on a box that says so, and a box has not said so yet: a
  // reload of `/admin/site` would be answered "not found" for the moments before it does, and then
  // be the console. Waited for here, and only here: no other address waits on the box.
  if (!aboutAnswered && (pathname === '/admin/site' || pathname.startsWith('/admin/site/'))) {
    return <RouteFallback />
  }
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* The front door is the guest join screen: it is the only address printed on a card,
            and it stays the guest's. A host does not get there by a redirect (that would cost
            the guest screen a request to ask who is looking): they type `/login` or follow the
            discreet "Espace organisateur" link the guest layout carries. */}
        <Route path="/" element={<Navigate to="/join" replace />} />

        <Route element={<GuestLayout />}>
          <Route path="/join" element={titled('join', <JoinPage />)} />
          {/* A path, not a query string. 1.0 emitted `?partyname=` and read `?party`,
              so every guest silently uploaded to the default event. */}
          <Route path="/join/:code" element={titled('join', <JoinPage />)} />
          <Route path="/e/:slug/upload" element={titled('upload', <GuestUploadPage />)} />
          <Route path="/e/:slug/photos" element={titled('feed', <GuestFeedPage />)} />
          <Route path="/e/:slug" element={<EventFrontDoor />} />
          {/* The guest's own dead ends, answered on the guest's own surface.
              A card printed against an older URL shape, a link forwarded through a
              group chat, a path that gained a segment: the reader is holding a phone
              and may not read French, and "this address does not exist, go here
              instead" is the whole value of the screen. The host catch-all below still
              answers everything else, at host width, which is right for a mistyped
              `/admin` address. */}
          <Route path="/join/*" element={titled('notFound', <NotFoundView />)} />
          <Route path="/e/*" element={titled('notFound', <NotFoundView />)} />
          {/* The shared gallery. The token is a path segment, like the join code, and it
              is the whole credential: nothing here signs anybody in. */}
          <Route element={<LazyGuestPage />}>
            <Route path="/g/:token" element={titled('gallery', <GalleryPage />)} />
            <Route path="/about" element={titled('about', <AboutPage />)} />
          </Route>
          <Route path="/g/*" element={titled('notFound', <NotFoundView />)} />
        </Route>

        {/* Public, and behind no session: a projector has nobody to log it in. */}
        <Route element={<WallLayout />}>
          <Route path="/e/:slug/display" element={titled('wall', <WallPage />)} />
        </Route>

        <Route element={<HostLayout />}>
          <Route path="/login" element={titled('login', <LoginPage />)} />

          {/* The pages a link or a forgotten password opens, with no session behind them. The
              token is the last segment of the address, like the gallery's; `/invite` and
              `/password` alone are the catch-all's, not these. */}
          <Route path="/invite/:token" element={titled('invitation', <AcceptInvitationPage />)} />
          <Route
            path="/password/forgot"
            element={titled('forgotPassword', <ForgotPasswordPage />)}
          />
          <Route
            path="/password/reset/:token"
            element={titled('resetPassword', <ResetPasswordPage />)}
          />

          <Route element={<RequireAuth />}>
            <Route element={<MustChangePasswordGate />}>
              <Route path="/admin" element={titled('dashboard', <AdminDashboardPage />)} />
              <Route path="/admin/events/new" element={titled('newEvent', <EventCreatePage />)} />
              <Route path="/admin/events/:slug" element={titled('event', <EventDetailPage />)} />
              <Route
                path="/admin/events/:slug/moderation"
                element={titled('moderation', <ModerationPage />)}
              />
              {/* Beside the console rather than instead of it: the host chooses the
                  surface by choosing the address, and a phone-shaped screen is a
                  different screen, not a narrow one. */}
              <Route
                path="/admin/events/:slug/moderation/mobile"
                element={titled('mobileModeration', <MobileModerationPage />)}
              />
              <Route
                path="/admin/events/:slug/settings"
                element={titled('settings', <EventSettingsPage />)}
              />
              <Route
                path="/admin/events/:slug/settings/ambiance"
                element={titled('customAmbiance', <CustomAmbiancePage />)}
              />
              {siteAdmin ? (
                <Route path="/admin/client" element={titled('clientSpace', <ClientSpacePage />)} />
              ) : null}
              {/* The operator's console. Registered only where the box has one, and then only
                  for the account that operates it: anybody else is answered the not-found
                  screen, as for an address nobody wrote, and is told nothing about a console. */}
              {siteAdmin ? (
                <Route
                  element={<RequireOperator fallback={titled('notFound', <HostNotFoundView />)} />}
                >
                  <Route element={<SiteLayout />}>
                    <Route path="/admin/site" element={titled('site', <SiteClientsPage />)} />
                    <Route
                      path="/admin/site/clients/:clientId"
                      element={titled('siteClient', <SiteClientPage />)}
                    />
                    <Route
                      path="/admin/site/accounts"
                      element={titled('siteAccounts', <SiteAccountsPage />)}
                    />
                    <Route
                      path="/admin/site/audit"
                      element={titled('siteAudit', <SiteAuditPage />)}
                    />
                  </Route>
                </Route>
              ) : null}
              <Route
                path="/admin/password"
                element={titled('changePassword', <ChangePasswordPage />)}
              />
              {/* Erasing one's own account: only where the box has accounts for other people, which is
                  where the server mounts the route. */}
              {siteAdmin ? (
                <Route
                  path="/admin/account/delete"
                  element={titled('deleteAccount', <DeleteAccountPage />)}
                />
              ) : null}
              {/* The operator's second factor (G2-13). The console's gate links here for an
                  operator who has not enrolled; the address is otherwise the entry. */}
              <Route path="/admin/security" element={titled('security', <SecurityPage />)} />
            </Route>
          </Route>

          {/* The list of events is the dashboard: `/admin/events` was a parent address nobody
              registered, so it was a 404 and a dead end for a breadcrumb that pointed at it. Outside the
              gate on purpose: `/admin` is gated, and a signed-out host is sent to sign in from there. */}
          <Route path="/admin/events" element={<Navigate to="/admin" replace />} />

          {/* Not a redirect to the upload page. See NotFoundView. This one knows who is looking:
              a signed-in host is offered `/admin`, not the guest's start. */}
          <Route path="*" element={titled('notFound', <HostNotFoundView />)} />
        </Route>
      </Routes>
    </Suspense>
  )
}
