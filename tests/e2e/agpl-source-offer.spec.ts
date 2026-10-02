import type { APIRequestContext } from '@playwright/test'
import { expect, joinAsGuest, test } from './fixtures/app'
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
 * `GET /api/about` publishes. Two things only this ring can show:
 *
 * - **The two halves agree.** The footer paints from a build-time address Vite baked into
 *   the bundle and then takes the server's. A drift between `web/buildInfo.ts` and
 *   `resolveSourceUrl` would show as a link that flashes one address and settles on
 *   another; `toHaveAttribute` retries, so it asserts the settled one, which is the one
 *   an operator controls.
 * - **Which surfaces carry it.** The guest and host layouts do and the projected wall does
 *   not. Ring 5 asserts that in jsdom; here it is the production route table behind a real
 *   browser, which is the thing a layout edit would break.
 *
 * Removing the footer from `GuestLayout` or `HostLayout` turns the first three tests red.
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
      links: {},
      features: { siteAdmin: false },
    })
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
})
