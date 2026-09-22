import {
  test as base,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { startTestApp, type TestApp } from './startTestApp'
import { SUITE_LOCALE } from './suiteLocale'
import { SUPPORTED_LOCALES } from '../../../web/src/lib/i18n/locale'
import { TRANSLATIONS, type UiText } from '../../../web/src/lib/i18n/translations'

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
    // eslint-disable-next-line no-empty-pattern -- Playwright's API requires it, see above.
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
 * The origin the visual suite's servers tell a guest's phone to use.
 *
 * Deliberately **not** the address those servers listen on. The wall's QR is built from
 * `PUBLIC_URL` (`toWallResponseDto`) rather than from the projector's own origin, so a
 * screen opened on `127.0.0.1:<ephemeral>` still prints a link a phone could act on — and
 * the bit pattern is the same in two renders of one commit, which is what a baseline over
 * that region needs. It was the last unpinned input in these shots and it sat in eight of
 * the twelve.
 *
 * Not a forged state, either: a fixed public address behind a listening address that is
 * not it *is* the reverse-proxied deployment, which is how most of these boxes run.
 * {@link startTestApp} otherwise passes its own base URL, which is the truth for a
 * directly reachable server and what the journeys should go on exercising.
 */
export const VISUAL_PUBLIC_URL = 'http://mur.eventslide.test'

/**
 * A server nobody else has touched, for one test.
 *
 * {@link test} above shares one per worker, which is right for a journey: booting a server
 * and running the migrations costs a second or two, and a suite that pays that per test
 * stops being run. It is wrong for a baseline. Under `E2E_HOOKS` the ids come from
 * `sequentialIdGenerator`, whose counters are per **process** — so what a test is handed
 * depends on how many calls preceded it on that server, and which other tests a worker
 * took first is the runner's decision rather than the spec's. A polaroid print's tilt is a
 * static hash of its photo id and the join code is drawn from the same generator, so two
 * renders of one commit disagreed by 243 291 pixels on a wall neither had touched.
 *
 * Here the event is always its server's first: the album is always photographs one to six
 * and the code is always {@link FIRST_JOIN_CODE}. The specs **assert** both rather than
 * trusting this comment — a fixture's promise that nothing checks is the defect class the
 * 55-mutation audit found every survivor behind.
 *
 * The cost is one server boot per test, twelve of them, in a job that already installs
 * Chromium and builds the application twice.
 */
export const freshServerTest = base.extend<{ surfaces: Surfaces; app: TestApp }>({
  // Playwright parses this parameter list to work out which fixtures the function depends
  // on, so the first argument must be a destructuring pattern even when empty — see the
  // note on `test` above.
  // eslint-disable-next-line no-empty-pattern -- Playwright's API requires it, see above.
  app: async ({}, use, testInfo) => {
    const app = await startTestApp({
      worker: testInfo.workerIndex,
      env: { PUBLIC_URL: VISUAL_PUBLIC_URL },
    })
    await use(app)
    await app.dispose()
  },

  surfaces: async ({ browser, app }, use) => {
    const surfaces = await openSurfaces(browser, app)
    await use(surfaces)
    await surfaces.dispose()
  },
})

/**
 * The join code a server with a fresh generator mints first.
 *
 * `sequentialIdGenerator.bytes` writes its own call number in the base the join code reads
 * its bytes in, so call one is `[0, 0, 0, 0, 0, 1]`, and `JoinCode.fromBytes` maps that
 * through `0123456789ABCDEFGHJKMNPQRSTVWXYZ`. Stated here because it is a property of the
 * generator; asserted by the specs because it is the property {@link freshServerTest}
 * exists to give them.
 */
export const FIRST_JOIN_CODE = '000001'

/** The nth photo id such a server mints, in the shape `sequentialIdGenerator` gives it. */
export const photoIdAt = (nth: number): string =>
  `f0000000-0000-4000-8000-${nth.toString(16).padStart(12, '0')}`

/**
 * Closes a context the way {@link Surfaces} does, swallowing only Playwright's own
 * artifact cleanup.
 *
 * A spec that opens a context of its own — the two reduced-motion baselines need
 * `reducedMotion: 'reduce'`, which is a context option — was closing it bare, and so had
 * none of the protection {@link openSurfaces} carries. On Windows that lost race turns a
 * suite whose assertions all passed into a red one, on a different test every run. It is
 * the same false red as the rest of this file's subject, arriving through the teardown
 * rather than through a pixel: it cost a render pass here, and the retry it provoked moved
 * the id counter and took the polaroid's tilts with it.
 */
export const closeQuietly = async (context: BrowserContext): Promise<void> => {
  try {
    await context.close()
  } catch (cause) {
    if (!isArtifactCleanupFailure(cause)) throw cause
  }
}

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

/**
 * Whether a rejected `context.close()` is Playwright tidying its own recordings rather
 * than anything to do with this suite.
 *
 * `trace`/`video: 'retain-on-failure'` means a *passing* test's recordings are deleted
 * as its contexts close, and on Windows that cleanup intermittently loses a race with
 * itself: `browserContext.close` rejects with
 * `ENOENT ... .playwright-artifacts-N/traces/<id>-recordingN.trace` after the context is
 * already gone. It lands on whichever test happens to be closing at the time — a
 * different one on every run — so a suite whose assertions all passed goes red on a test
 * that did nothing wrong, and the reported failure count stops meaning anything. It
 * surfaced here only as the suite got greener: a failing test keeps its recordings, so
 * there is nothing to race over.
 *
 * Narrow on purpose. A recording that could not be deleted is not worth a red suite; any
 * other close failure still is, including one that leaves a browser behind.
 */
const isArtifactCleanupFailure = (cause: unknown): boolean =>
  cause instanceof Error &&
  cause.message.includes('ENOENT') &&
  cause.message.includes('playwright-artifacts')

export const openSurfaces = async (browser: Browser, app: TestApp): Promise<Surfaces> => {
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    baseURL: app.baseUrl,
    // Stated, not inherited. `use.locale` in `playwright.config.ts` reaches the `page`
    // and `context` fixtures and **not** a manual `newContext()`, so these three were
    // taking the language of whoever ran the suite. `suiteLocale.ts` has the argument.
    locale: SUITE_LOCALE,
  })
  const hostContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    baseURL: app.baseUrl,
    locale: SUITE_LOCALE,
  })
  const projectorContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    baseURL: app.baseUrl,
    locale: SUITE_LOCALE,
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
      // `allSettled`, so one surface failing to close still closes the other two rather
      // than leaving them open for the rest of the worker's life.
      const outcomes = await Promise.allSettled([
        guestContext.close(),
        hostContext.close(),
        projectorContext.close(),
      ])

      for (const outcome of outcomes) {
        if (outcome.status !== 'rejected') continue
        const cause: unknown = outcome.reason
        if (isArtifactCleanupFailure(cause)) continue
        throw cause
      }
    },
  }
}

/** A copy label is prose, and prose contains `?`, `(` and `.`. */
const escapeForPattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/**
 * One label, in any of the five languages, as a single pattern.
 *
 * The sign-in form used to be French whatever the browser asked for, so the helper below
 * could match `/Adresse e-mail/i` and be done. It is translated now, and
 * `playwright.config.ts` pins the suite to `fr-FR` — so a spec that sets its own locale
 * with `test.use({ locale })` and then signs in meets a German form and a French matcher,
 * and fails on a timeout twenty lines from the cause. This branch built exactly that trap
 * and walked into it the first time it wrote such a spec.
 *
 * Built from the tables rather than written out, so a reworded label cannot leave this
 * matching a sentence the form no longer shows.
 */
const inAnyLanguage = (pick: (text: UiText) => string): RegExp =>
  new RegExp(
    SUPPORTED_LOCALES.map((locale) => escapeForPattern(pick(TRANSLATIONS[locale]))).join('|'),
    'iu',
  )

/**
 * Signs a host in through the real login form.
 *
 * Not by injecting a cookie: the login path is part of what the suite covers, and a
 * fixture that forges a session would let a broken login ship green.
 */
export const signInAsHost = async (page: Page, app: TestApp): Promise<void> => {
  await page.goto(app.url('/login'))
  await page.getByLabel(inAnyLanguage((text) => text.auth.email)).fill(app.owner.email)
  await page.getByLabel(inAnyLanguage((text) => text.auth.password)).fill(app.owner.password)
  await page.getByRole('button', { name: inAnyLanguage((text) => text.auth.submit) }).click()
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
 * The display URL a projector is left on, with the query a test needs on it.
 *
 * The two timing hooks make the wall assertable without waiting ten real seconds a
 * slide. They are only honoured when the server was started with `E2E_HOOKS=1`, and the
 * config module refuses to boot production with that flag set — so they cannot leak
 * into a real deployment.
 *
 * `layout` is not a test hook: it is the product's own way of pointing a kiosk at a
 * layout, read in the browser by `web/src/features/wall/hooks/useLayoutParam.ts` and
 * sent to no API. An unknown value is ignored there, which is why a spec may pass one.
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
