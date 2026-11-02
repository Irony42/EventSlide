import { describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { AppRoutes } from './router'
import ROUTER from './router.tsx?raw'
import { de } from '../lib/i18n/de'
import { fr } from '../lib/i18n/fr'
import { rememberGuestSession } from '../lib/guestSession'
import {
  anAbout,
  aPublicEvent,
  aSessionUser,
  fakeApi,
  renderWithProviders,
} from '../testing/renderWithProviders'
import type { SessionResponse } from '../lib/api/dto'

/**
 * Every address the router serves says what it is in the browser tab (WCAG 2.4.2).
 *
 * Every address used to carry the one `<title>EventSlide</title>` from `index.html`, so a
 * host with the console, the wall and the phone console open could not tell the tabs
 * apart. The tables below are the router's, row for row; `titled(...)` at every route is held
 * by reading `router.tsx` itself (the tables are typed by hand and could not notice a route
 * added beside them), and the last two tests hold the tables to `fr.titles`: a page added
 * without a title, or a title nobody uses, fails here and not in somebody's tab strip.
 */

const TOKEN = 'Q'.repeat(43)

type Key = keyof typeof fr.titles

/** A host on a box that has a client space, which is what `/admin/client` needs. */
const asHost = (route: string, locale: 'fr' | 'de' = 'fr', operator = false) => {
  const api = fakeApi({
    session: vi.fn(async (): Promise<SessionResponse> => ({
      authenticated: true,
      user: aSessionUser({ canOperateSite: operator }),
    })),
    about: vi.fn(async () => anAbout({ features: { siteAdmin: true, forgotPassword: true } })),
  })
  return renderWithProviders(<AppRoutes />, { api, route, locale })
}

const titled = (key: Key, locale: typeof fr | typeof de = fr): string =>
  `${locale.titles[key]} · ${locale.app.name}`

/**
 * The tab reads `key`'s title, and it is the only `<title>` in the head. jsdom starts with
 * none, so a second one (a layout that names itself beside the page) would read as 2: the
 * browser shows the first, so nothing else would notice until commit order changed.
 */
const expectTabToRead = (key: Key, locale: typeof fr | typeof de = fr) =>
  waitFor(() => {
    expect(document.title).toBe(titled(key, locale))
    expect(document.head.querySelectorAll('title')).toHaveLength(1)
  })

const GUEST: readonly (readonly [string, Key])[] = [
  ['/join', 'join'],
  ['/join/H7K2QM', 'join'],
  ['/e/camille-et-sacha/upload', 'upload'],
  ['/e/camille-et-sacha/photos', 'feed'],
  ['/e/camille-et-sacha/display', 'wall'],
  [`/g/${TOKEN}`, 'gallery'],
  ['/about', 'about'],
  ['/join/H7K2QM/too/many', 'notFound'],
  ['/e/camille-et-sacha/album', 'notFound'],
  [`/g/${TOKEN}/extra`, 'notFound'],
]

const HOST_WITHOUT_SESSION: readonly (readonly [string, Key])[] = [
  ['/login', 'login'],
  [`/invite/${TOKEN}`, 'invitation'],
  ['/password/forgot', 'forgotPassword'],
  [`/password/reset/${TOKEN}`, 'resetPassword'],
  ['/admin/evenements', 'notFound'],
]

const HOST_SIGNED_IN: readonly (readonly [string, Key])[] = [
  ['/admin', 'dashboard'],
  ['/admin/events/new', 'newEvent'],
  ['/admin/events/mariage', 'event'],
  ['/admin/events/mariage/moderation', 'moderation'],
  ['/admin/events/mariage/moderation/mobile', 'mobileModeration'],
  ['/admin/events/mariage/stats', 'stats'],
  ['/admin/events/mariage/settings', 'settings'],
  ['/admin/events/mariage/settings/ambiance', 'customAmbiance'],
  ['/admin/events/mariage/print', 'print'],
  ['/admin/client', 'clientSpace'],
  ['/admin/password', 'changePassword'],
  ['/admin/security', 'security'],
  ['/admin/account/delete', 'deleteAccount'],
]

/** The operator's console: only for the account that operates a box that has one. */
const OPERATOR: readonly (readonly [string, Key])[] = [
  ['/admin/site', 'site'],
  ['/admin/site/clients/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'siteClient'],
  ['/admin/site/accounts', 'siteAccounts'],
  ['/admin/site/audit', 'siteAudit'],
  ['/admin/site/takedown', 'siteTakedown'],
]

/** The addresses that answer with a redirect and so have no page to name. */
const REDIRECTS = new Set(['/', '/e/:slug', '/admin/events'])

describe('the browser tab', () => {
  it.each(GUEST)('names %s after the page', async (route, key) => {
    rememberGuestSession({ event: aPublicEvent(), displayName: null, privacyNotice: null })

    renderWithProviders(<AppRoutes />, { route })

    await expectTabToRead(key)
  })

  it.each(HOST_WITHOUT_SESSION)('names %s after the page', async (route, key) => {
    renderWithProviders(<AppRoutes />, { route })

    await expectTabToRead(key)
  })

  it.each(HOST_SIGNED_IN)('names %s after the page', async (route, key) => {
    asHost(route)

    await expectTabToRead(key)
  })

  it.each(OPERATOR)('names %s after the page, for the operator', async (route, key) => {
    asHost(route, 'fr', true)

    await expectTabToRead(key)
  })

  it.each(OPERATOR)(
    'names %s as an unknown address for a host who is not the operator',
    async (route) => {
      asHost(route)

      await expectTabToRead('notFound')
    },
  )

  it('names the page in the language the reader is in', async () => {
    asHost('/admin/events/mariage/moderation', 'de')

    await expectTabToRead('moderation', de)
  })

  it('names every address the router declares, not only the ones listed above', () => {
    // The tables above are typed by hand. This reads the route table itself, so a route
    // added without `titled(...)` fails here even though no row mentions it. The one
    // addresses that render no page are the `<Navigate>`s: `/`, `/e/:slug` and `/admin/events`.
    const routes = [
      ...ROUTER.matchAll(/<Route\s+path="([^"]+)"[\s\S]{0,160}?element=\{(titled\(|<[A-Za-z]+)/g),
    ].flatMap((match) =>
      match[1] === undefined || match[2] === undefined ? [] : [[match[1], match[2]] as const],
    )

    const untitled = routes
      .filter(([path, opening]) => !REDIRECTS.has(path) && opening !== 'titled(')
      .map(([path]) => path)

    expect(routes.length).toBeGreaterThan(20)
    expect(untitled).toEqual([])
  })

  it('names the same pages in the tables above as the route table does, and uses every title', () => {
    const inRouter = new Set(
      [...ROUTER.matchAll(/titled\('([A-Za-z]+)'/g)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      ),
    )
    const inTables = new Set<string>(
      [...GUEST, ...HOST_WITHOUT_SESSION, ...HOST_SIGNED_IN, ...OPERATOR].map(([, key]) => key),
    )
    const declared = Object.keys(fr.titles).sort()

    // A title nobody uses and a page the tables forgot are the same drift.
    expect([...inRouter].sort()).toEqual(declared)
    expect([...inTables].sort()).toEqual(declared)
  })
})
