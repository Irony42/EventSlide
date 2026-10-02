import { test as base, type APIRequestContext } from '@playwright/test'
import { expect, joinAsGuest, test } from './fixtures/app'
import { startTestApp, type TestApp } from './fixtures/startTestApp'
import { fr } from '../../web/src/lib/i18n/fr'
import type { About } from '../../web/src/lib/api/dto'

/**
 * The AGPL section 13 source offer, from the screen a visitor actually sees (roadmap
 * G1-04 / P1-05, ring 6).
 *
 * A user of a network service is entitled to the source of the version they are talking
 * to, so the claim worth a browser is not that a component renders a link — ring 5 has
 * that — but that **on a real server and a real bundle**, the first screen a guest lands
 * on and the first screen a host lands on each carry a link whose address is the one
 * `GET /api/about` publishes. Three things only this ring can show:
 *
 * - **The link is on the right surfaces.** The guest and host layouts carry it and the
 *   projected wall does not. Ring 5 asserts that in jsdom; here it is the production route
 *   table behind a real browser, which is the thing a layout edit would break.
 * - **The server's address replaces the bundle's.** The footer paints from an address
 *   Vite baked into the bundle and then takes the one `/api/about` publishes. On a stock
 *   server those are the same string, so the tests on the stock server cannot tell a
 *   footer that read the response from one that never asked — the fork test at the bottom
 *   can: it boots a server whose `SOURCE_CODE_URL` is not the default, so the only place
 *   its address can come from is the response.
 * - **The endpoint costs a visitor nothing.** No cookie on the response, from a real
 *   server with the real middleware order.
 *
 * Removing the footer from `GuestLayout` or `HostLayout` turns the join, login and console
 * tests red; making `useAbout` ignore the response turns the fork test red.
 */

const SOURCE_LINK = fr.about.sourceCode

/** What the server publishes, read the way any client would. */
const aboutOf = async (request: APIRequestContext, url: string): Promise<About> =>
  (await (await request.get(url)).json()) as About

test.describe('the AGPL source offer', () => {
  test('GET /api/about publishes the version, the licence and the source, and no cookie @smoke', async ({
    app,
    request,
  }) => {
    const response = await request.get(app.url('/api/about'))

    expect(response.status()).toBe(200)
    const about = (await response.json()) as About
    expect(about).toMatchObject({
      name: 'EventSlide',
      license: 'AGPL-3.0-only',
      features: { siteAdmin: false },
    })
    // Exactly empty, not "an object": `toMatchObject({ links: {} })` matches any object, so it
    // could not see a box that set nothing and still published a donation page (G4-02).
    expect(about.links).toEqual({})
    expect(about.sourceUrl).toMatch(/^https:\/\//)
    expect(about.version).toMatch(/^\d+\.\d+\.\d+/)
    // A visit to the offer costs the box no session and plants no cookie in a phone that
    // is only reading it.
    expect(response.headers()['set-cookie']).toBeUndefined()
  })

  test('the guest join screen carries the link, and it is the address the server offers @smoke', async ({
    app,
    page,
    request,
  }) => {
    const { sourceUrl } = await aboutOf(request, app.url('/api/about'))

    await page.goto(app.url('/join'))

    const link = page.getByRole('link', { name: SOURCE_LINK })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', sourceUrl)
    // In a tab of its own, and unable to reach back into the page that opened it.
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
  })

  test('the host login screen carries it too, at the same address @smoke', async ({
    app,
    page,
    request,
  }) => {
    const { sourceUrl } = await aboutOf(request, app.url('/api/about'))

    await page.goto(app.url('/login'))

    const link = page.getByRole('link', { name: SOURCE_LINK })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', sourceUrl)
    await expect(link).toHaveAttribute('rel', /noopener/)
  })

  test('a signed-in host sees it on the console', async ({ app, surfaces, request }) => {
    const { sourceUrl } = await aboutOf(request, app.url('/api/about'))

    await surfaces.host.goto(app.url('/admin'))

    const link = surfaces.host.getByRole('link', { name: SOURCE_LINK })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', sourceUrl)
  })

  test('a guest who has joined still sees it, under the composer', async ({
    app,
    surfaces,
    request,
  }) => {
    const { sourceUrl } = await aboutOf(request, app.url('/api/about'))
    const event = await app.seedEvent({ slug: 'offre-de-source', name: 'Camille & Sacha' })

    await joinAsGuest(surfaces.guest, app, event.joinCode, 'Léa')

    const link = surfaces.guest.getByRole('link', { name: SOURCE_LINK })
    await link.scrollIntoViewIfNeeded()
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', sourceUrl)
  })

  test('the projected wall does not carry it, because nobody in that room is the one it is offered to', async ({
    app,
    surfaces,
  }) => {
    const event = await app.seedEvent({ slug: 'mur-sans-pied', name: 'Camille & Sacha' })

    await surfaces.projector.goto(app.url(`/e/${event.slug}/display`))

    // The wall has rendered once its empty state is up; asserting an absence before that
    // would be asserting it of a blank page.
    await expect(surfaces.projector.getByTestId('wall-empty')).toBeVisible()
    await expect(surfaces.projector.getByRole('link', { name: SOURCE_LINK })).toHaveCount(0)
    await expect(surfaces.projector.getByRole('contentinfo')).toHaveCount(0)
  })

  test('/about shows the version, the licence and the source the server offers', async ({
    app,
    page,
    request,
  }) => {
    const about = await aboutOf(request, app.url('/api/about'))

    await page.goto(app.url('/about'))

    await expect(page.getByRole('heading', { level: 1, name: fr.about.title })).toBeVisible()
    await expect(page.getByText(about.version, { exact: true })).toBeVisible()
    await expect(page.getByText('AGPL-3.0-only', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: about.sourceUrl })).toHaveAttribute(
      'href',
      about.sourceUrl,
    )
  })

  test('/about links the licence notices, and the server sends the file the build wrote', async ({
    app,
    page,
    request,
  }) => {
    // Roadmap G1-07 / P1-09. MIT and ISC ask that their notice travel with the code, and the
    // minified bundle carries none. Only a real build and a real static mount can show that
    // the file exists, is not swallowed by the SPA fallback, and is plain text a phone can
    // open: ring 5 has the link, and `scripts/thirdPartyNotices.test.ts` the build.
    await page.goto(app.url('/about'))

    const link = page.getByRole('link', { name: new RegExp(fr.about.noticesLink) })
    await expect(link).toHaveAttribute('href', '/third-party-licenses.txt')
    await expect(link).toHaveAttribute('rel', /noopener/)

    const response = await request.get(app.url('/third-party-licenses.txt'))

    expect(response.status()).toBe(200)
    // Not `index.html`: an SPA fallback answering a missing file is the failure to catch.
    expect(response.headers()['content-type']).toMatch(/^text\/plain/)
    const notices = await response.text()
    for (const name of ['react', 'react-router', 'qrcode.react']) {
      expect(notices, `${name} is bundled, so its notice is served`).toMatch(
        new RegExp(`^${name.replace('.', '\\.')} \\d+\\.\\d+\\.\\d+$`, 'm'),
      )
    }
    expect(notices).toContain('Permission is hereby granted')
  })
})

/**
 * A deployment of a fork: its own server, started with a `SOURCE_CODE_URL` that is not the
 * upstream default, so the bundle's baked-in address and the server's answer differ.
 */
const FORK_SOURCE_URL = 'https://source.fork.example/eventslide/tree/our-release'

const forkTest = base.extend<{ fork: TestApp }>({
  // Playwright parses this parameter list to work out which fixtures the function depends
  // on, so the first argument must be a destructuring pattern even when empty — see the
  // note on `test` in fixtures/app.ts.
  // eslint-disable-next-line no-empty-pattern -- Playwright's API requires it, see above.
  fork: async ({}, use, testInfo) => {
    const fork = await startTestApp({
      worker: testInfo.workerIndex,
      env: { SOURCE_CODE_URL: FORK_SOURCE_URL },
    })
    await use(fork)
    await fork.dispose()
  },
})

forkTest.describe('a deployment that sets SOURCE_CODE_URL', () => {
  forkTest(
    'offers that address on the join screen, not the one baked into the bundle',
    async ({ fork, page, request }) => {
      const about = await aboutOf(request, fork.url('/api/about'))
      expect(about.sourceUrl).toBe(FORK_SOURCE_URL)

      await page.goto(fork.url('/join'))

      // `toHaveAttribute` retries, so this is the settled address: the first paint is the
      // upstream tag from the bundle, and only the response can turn it into this one.
      await expect(page.getByRole('link', { name: SOURCE_LINK })).toHaveAttribute(
        'href',
        FORK_SOURCE_URL,
      )
    },
  )

  forkTest('offers it on /about too', async ({ fork, page }) => {
    await page.goto(fork.url('/about'))

    await expect(page.getByRole('link', { name: FORK_SOURCE_URL })).toHaveAttribute(
      'href',
      FORK_SOURCE_URL,
    )
  })
})
