import { test as base, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { startTestApp, type TestApp } from './startTestApp'

/**
 * One server per Playwright worker, torn down with it.
 *
 * Worker-scoped rather than per-test: booting a server and running the migrations costs
 * a second or two, and a suite that pays that per test stops being run. Tests isolate
 * themselves by seeding their own event instead, which is cheap and closer to reality
 * — a real deployment serves several events from one process.
 */
export const test = base.extend<{ surfaces: Surfaces }, { app: TestApp }>({
  app: [
    // Playwright parses this parameter list to work out which fixtures the function
    // depends on, so the first argument must be written as a destructuring pattern even
    // when nothing is taken from it — a plain `_fixtures` is rejected at collection time
    // with "First argument must use the object destructuring pattern", before any test
    // runs.
    async ({}, use, workerInfo) => {
      const app = await startTestApp({ worker: workerInfo.workerIndex })
      await use(app)
      await app.dispose()
    },
    { scope: 'worker' },
  ],

  surfaces: async ({ browser, app }, use) => {
    const surfaces = await openSurfaces(browser, app)
    await use(surfaces)
    await surfaces.dispose()
  },
})

export { expect } from '@playwright/test'

/**
 * The three screens, as three browser contexts.
 *
 * The product is three people looking at three screens at once, and most of its
 * interesting behaviour is the propagation between them. Modelling that literally —
 * separate contexts, so separate cookie jars — is what lets a journey assert that the
 * wall stays empty until the host decides, which a single-page test cannot express.
 */
export interface Surfaces {
  /** A phone. Its own cookie jar, so it holds a guest token and no session. */
  readonly guest: Page
  /** A laptop with a host session. */
  readonly host: Page
  /** The projector: no credentials at all, and no input device assumed. */
  readonly projector: Page
  dispose(): Promise<void>
}

export const openSurfaces = async (browser: Browser, app: TestApp): Promise<Surfaces> => {
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    baseURL: app.baseUrl,
  })
  const hostContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    baseURL: app.baseUrl,
  })
  const projectorContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    baseURL: app.baseUrl,
    // The wall runs unattended; reduced motion is off so the crossfade and Ken Burns
    // are exercised as a room would see them.
    reducedMotion: 'no-preference',
  })

  const guest = await guestContext.newPage()
  const host = await hostContext.newPage()
  const projector = await projectorContext.newPage()

  // The host arrives signed in, because that is what `Surfaces.host` promises and what
  // every journey assumes when it navigates straight to an `/admin` address. Leaving it
  // anonymous made each of those navigations land on the login screen, and the failure
  // then surfaced as "moderation card not found" — a symptom several assertions away
  // from its cause.
  //
  // The guest and the projector are deliberately left with no credentials at all: a
  // guest earns a device token by joining, and a projector has nobody to log it in.
  await signInAsHost(host, app)

  return {
    guest,
    host,
    projector,
    dispose: async () => {
      await Promise.all([guestContext.close(), hostContext.close(), projectorContext.close()])
    },
  }
}

/**
 * Signs a host in through the real login form.
 *
 * Not by injecting a cookie: the login path is part of what the suite covers, and a
 * fixture that forges a session would let a broken login ship green.
 */
export const signInAsHost = async (page: Page, app: TestApp): Promise<void> => {
  await page.goto(app.url('/login'))
  await page.getByLabel(/Adresse e-mail/i).fill(app.owner.email)
  await page.getByLabel(/Mot de passe/i).fill(app.owner.password)
  await page.getByRole('button', { name: /Se connecter/i }).click()
  // Deliberately not `/\/admin/`: `/admin/password` matches that too, so a host stuck
  // behind the forced-rotation gate would satisfy the wait and then fail at whatever the
  // test asserted next, twenty lines away from the cause. The fixture rotates the
  // bootstrap password at boot (see `OWNER_SETTLED_PASSWORD`), so landing here means
  // something regressed, and it should say so.
  await page.waitForURL(/\/admin(?:\/(?!password))?/)
}

/**
 * Joins an event as a guest, through the real join page.
 *
 * `displayName` omitted means an anonymous guest, which is a supported path and worth
 * exercising rather than always naming somebody.
 */
export const joinAsGuest = async (
  page: Page,
  app: TestApp,
  joinCode: string,
  displayName?: string,
): Promise<void> => {
  await page.goto(app.url(`/join/${joinCode}`))
  if (displayName !== undefined) {
    await page.getByLabel(/Votre prénom/i).fill(displayName)
  }
  await page.getByRole('button', { name: /Rejoindre/i }).click()
  await page.waitForURL(/\/e\/[^/]+\/upload/)
}

/**
 * Query hooks that make the wall testable without waiting ten real seconds a slide.
 *
 * Only honoured when the server was started with `E2E_HOOKS=1`, and the config module
 * refuses to boot production with that flag set — so this cannot leak into a real
 * deployment.
 */
export const wallUrl = (
  app: TestApp,
  slug: string,
  options: { layout?: string; intervalMs?: number; transitionMs?: number } = {},
): string => {
  const query = new URLSearchParams()
  if (options.layout !== undefined) query.set('layout', options.layout)
  query.set('e2e_interval', String(options.intervalMs ?? 250))
  query.set('e2e_transition', String(options.transitionMs ?? 0))
  return app.url(`/e/${slug}/display?${query.toString()}`)
}

/**
 * The CSRF header a mutating request has to carry, for a spec that drives the API
 * directly instead of through a page.
 *
 * Not a workaround. Double-submit CSRF is checked *before* anything that acts on
 * identity, which is the right order — an integrity check on the request has to pass
 * before the server decides what the caller may do. The consequence for a test is that
 * a raw `request.post` with no token is refused with `request.csrfMissing` long before
 * it reaches the control the test is about, so a spec asserting `guest.wrongEvent` or a
 * 401 never gets there and reads as a product failure.
 *
 * A browser sends this pair automatically; `APIRequestContext` does not. `es_csrf` is
 * readable by design, because guests have no session to bind a token to.
 */
export const csrfHeaders = async (
  api: APIRequestContext,
  app: TestApp,
): Promise<Record<string, string>> => {
  // Any GET issues the cookie; this one is public and cheap.
  await api.get(app.url('/api/auth/me'))
  const cookies = await api.storageState().then((state) => state.cookies)
  const token = cookies.find((cookie) => cookie.name === 'es_csrf')?.value
  if (token === undefined) throw new Error('the server issued no es_csrf cookie')
  return { 'x-csrf-token': token }
}
