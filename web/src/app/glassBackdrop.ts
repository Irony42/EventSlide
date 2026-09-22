import { matchRoutes } from 'react-router-dom'
import type { GlassBackdrop } from '../design-system/glass'

/**
 * What can be painted beneath a glass pane, per address — roadmap 11.2.
 *
 * `design-system/glass.ts` holds the rule; this holds the one input the design system
 * cannot have, because route shapes belong to the application and the arrow between the
 * two points this way. It is the same split `eventTheme.ts` makes: the derivation lives in
 * the design system, the decision about which screen carries it does not.
 *
 * ## Why a table rather than a prop on the page
 *
 * The surface element is `AppShell`, and the thing that knows whether a photograph can
 * appear is the page several levels below it. Nothing travels up a React tree in the same
 * paint — a context write lands a frame late, which is exactly the flash of the wrong
 * material that roadmap 2.2 argued out for the event theme — so the two facts have to meet
 * somewhere that knows both, and the route table is the only place that does.
 *
 * ## Why the table is not the guard
 *
 * A table is a claim, and a claim about the whole subtree of a page is one somebody will
 * eventually get wrong: the moderation queue is one careless line away from asking for the
 * translucent tier over a hundred guest photographs. So `glassBackdrop.test.ts` walks the
 * real import graph from each page module and refuses a `ground` claim whose subtree can
 * render an `<img>`, a `<video>`, or a field brighter than the backdrop that floor was
 * derived against. The table says what a screen believes; the test says whether it is true.
 */

interface RouteBackdrop {
  /** The path exactly as `router.tsx` declares it. A test fails if the two drift apart. */
  readonly path: string
  readonly backdrop: GlassBackdrop
  /**
   * The module this route renders, relative to `web/src`.
   *
   * Carried so the guard can start its walk somewhere real. Without it the table would be
   * a list of strings checkable only against itself, which is the kind of test that goes
   * green while the thing it names has changed underneath it.
   */
  readonly page: string
}

/**
 * Every address this application answers, and what it can paint under a pane.
 *
 * The four `photo` entries are the whole of the interesting half:
 *
 * - `/e/:slug/upload` — the guest's own uploads scroll under the composer.
 * - `/e/:slug/display` — the wall is nothing but guest photographs. It takes the opaque
 *   tier from the surface rule regardless, and is listed truthfully all the same: a
 *   backdrop that lied here would become wrong the day the room could afford a filter.
 * - the two moderation consoles — a hundred tiles under a sticky bar, and a lightbox.
 * - `/admin/events/:slug` — **and this one has no guest photograph on it at all.** It
 *   prints the event's QR plate, which is `--text-primary` on `EventQrCard`, a near-white
 *   field a code has to be dark-on-light to scan at all. A contrast ratio cannot tell that
 *   apart from a white dress in full sun, so the screen is held to the same floor. It is
 *   the entry that says why the guard checks brightness and not provenance — "no guest
 *   photo here" was the obvious rule and it would have been wrong on this address.
 */
export const ROUTE_BACKDROPS: readonly RouteBackdrop[] = [
  { path: '/join', backdrop: 'ground', page: 'features/join/JoinPage.tsx' },
  { path: '/join/:code', backdrop: 'ground', page: 'features/join/JoinPage.tsx' },
  { path: '/join/*', backdrop: 'ground', page: 'app/NotFoundView.tsx' },
  { path: '/e/:slug/upload', backdrop: 'photo', page: 'features/guest-upload/GuestUploadPage.tsx' },
  { path: '/e/:slug/display', backdrop: 'photo', page: 'features/wall/WallPage.tsx' },
  { path: '/e/*', backdrop: 'ground', page: 'app/NotFoundView.tsx' },
  // A grid of guest photographs scrolls under the download bar: the strict floor.
  { path: '/g/:token', backdrop: 'photo', page: 'features/gallery/GalleryPage.tsx' },
  { path: '/g/*', backdrop: 'ground', page: 'app/NotFoundView.tsx' },
  { path: '/login', backdrop: 'ground', page: 'features/auth/LoginPage.tsx' },
  { path: '/admin', backdrop: 'ground', page: 'features/admin/DashboardPage.tsx' },
  { path: '/admin/events/new', backdrop: 'ground', page: 'features/admin/NewEventPage.tsx' },
  { path: '/admin/events/:slug', backdrop: 'photo', page: 'features/admin/EventPage.tsx' },
  {
    path: '/admin/events/:slug/moderation',
    backdrop: 'photo',
    page: 'features/moderation/ModerationPage.tsx',
  },
  {
    path: '/admin/events/:slug/moderation/mobile',
    backdrop: 'photo',
    page: 'features/moderation/MobileModerationPage.tsx',
  },
  {
    path: '/admin/events/:slug/settings',
    backdrop: 'ground',
    page: 'features/admin/EventSettingsPage.tsx',
  },
  { path: '/admin/password', backdrop: 'ground', page: 'features/auth/ChangePasswordPage.tsx' },
  { path: '*', backdrop: 'ground', page: 'app/NotFoundView.tsx' },
]

/**
 * Ranked by React Router itself rather than by the order of the table.
 *
 * `/admin/events/new` and `/admin/events/:slug` both match `/admin/events/new`, and which
 * one wins is a question this file must not answer differently from the router that
 * actually renders the page. `matchRoutes` is the router's own ranking, so the two cannot
 * disagree; a hand-rolled first-match loop over this table would have picked whichever
 * entry happened to be written first.
 */
const RANKED = ROUTE_BACKDROPS.map(({ path }) => ({ path }))

/**
 * What the address at `pathname` can paint beneath a pane.
 *
 * Falls back to `photo` when nothing matches, which cannot happen while the table carries
 * `*` — and is the right answer anyway, because an unmatched address is one nobody has
 * looked at and the strict floor is the safe end to fail towards.
 */
export const glassBackdropFor = (pathname: string): GlassBackdrop => {
  const matched = matchRoutes(RANKED, pathname)?.at(-1)
  if (matched === undefined) return 'photo'
  const found = ROUTE_BACKDROPS.find((route) => route.path === matched.route.path)
  return found?.backdrop ?? 'photo'
}
