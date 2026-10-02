import { test as base, type APIRequestContext, type Page } from '@playwright/test'
import { expect, openSurfaces, type Surfaces } from './fixtures/app'
import { startTestApp, type TestApp } from './fixtures/startTestApp'
import { fr } from '../../web/src/lib/i18n/fr'
import type { About } from '../../web/src/lib/api/dto'

/**
 * The optional donation and public-budget links, on a real server and a real bundle
 * (roadmap G4-02, ring 6).
 *
 * The product claim is a boundary, and ring 5 holds it in jsdom: **the link is offered to a
 * host and on `/about`, and it is nowhere a guest or the room can be.** What only this ring
 * can show is the same thing from the production route table behind a real browser, with a
 * server that was booted with `DONATION_URL` set — so the address on screen can only have
 * come from the response — and the one behaviour that needs a real `localStorage`: a host
 * who closes the card on a closed event does not see it again after a reload.
 *
 * A donation unlocks nothing, so there is no journey here in which giving changes what
 * anybody sees: the instance answers the same to everyone, and that absence is the point.
 *
 * Making `GuestLayout` or `WallLayout` render the link turns the guest and projector tests
 * red. Refusing a bad address at boot is ring 3's (`env.test.ts`), where a refusal is cheap to
 * observe and a booted server is not.
 */

const DONATION_URL = 'https://donate.eventslide.test/fund'
const BUDGET_URL = 'https://donate.eventslide.test/fund/budget'

/** Worker-scoped: one server with both links set, shared by every case in the file. */
const test = base.extend<{ surfaces: Surfaces }, { donating: TestApp }>({
  donating: [
    // Playwright parses this parameter list to work out which fixtures the function depends
    // on, so the first argument must be a destructuring pattern even when empty — see the
    // note on `test` in fixtures/app.ts.
    // eslint-disable-next-line no-empty-pattern -- Playwright's API requires it, see above.
    async ({}, use, workerInfo) => {
      const app = await startTestApp({
        worker: workerInfo.workerIndex,
        env: { DONATION_URL, BUDGET_URL },
      })
      await use(app)
      await app.dispose()
    },
    { scope: 'worker' },
  ],

  surfaces: async ({ browser, donating }, use) => {
    const surfaces = await openSurfaces(browser, donating)
    await use(surfaces)
    await surfaces.dispose()
  },
})

/** Any link on the page that leads to the donation or budget page. */
const supportLinks = (page: Page) => page.locator(`a[href^="${new URL(DONATION_URL).origin}"]`)

/**
 * Two animation frames: enough for a response that has already arrived to reach the screen,
 * and not a wait on a clock. An absence asserted before this would be an absence of a page
 * that had not yet heard the answer.
 */
const flushed = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )

const aboutOf = async (request: APIRequestContext, app: TestApp): Promise<About> =>
  (await (await request.get(app.url('/api/about'))).json()) as About

test.describe('the donation and budget links', () => {
  test('GET /api/about publishes both, and only because the operator set them', async ({
    donating,
    request,
  }) => {
    const about = await aboutOf(request, donating)

    expect(about.links).toEqual({ donate: DONATION_URL, budget: BUDGET_URL })
  })

  test('/about offers the donation link and says that a donation unlocks nothing', async ({
    donating,
    page,
  }) => {
    await page.goto(donating.url('/about'))

    await expect(page.getByText(fr.about.supportNoCounterpart)).toBeVisible()
    const link = page.getByRole('link', { name: new RegExp(fr.about.supportLink) })
    await expect(link).toHaveAttribute('href', DONATION_URL)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    await expect(link).toHaveAttribute('rel', /noreferrer/)
    await expect(page.getByRole('link', { name: new RegExp(fr.about.budgetLink) })).toHaveAttribute(
      'href',
      BUDGET_URL,
    )
  })

  test('the host console footer carries it', async ({ donating, surfaces }) => {
    await surfaces.host.goto(donating.url('/admin'))

    await expect(
      surfaces.host.getByRole('link', { name: new RegExp(fr.about.supportLink) }),
    ).toHaveAttribute('href', DONATION_URL)
  })

  test('the host footer does not print it, so the QR card for the tables carries no ask', async ({
    donating,
    surfaces,
  }) => {
    const link = surfaces.host.getByRole('link', { name: new RegExp(fr.about.supportLink) })
    await surfaces.host.goto(donating.url('/admin'))
    await expect(link).toBeVisible()

    await surfaces.host.emulateMedia({ media: 'print' })

    await expect(link).toBeHidden()
  })

  test('a guest who lands on a stale address is under the host footer, which does not carry it', async ({
    donating,
    page,
  }) => {
    const answered = page.waitForResponse((response) => response.url().endsWith('/api/about'))

    // 1.0 printed `/upload?partyname=…`: outside every guest prefix, so the router's not-found
    // screen answers it, under the host layout.
    await page.goto(donating.url('/upload?partyname=mariage'))
    await answered
    await expect(page.getByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
    await flushed(page)

    await expect(supportLinks(page)).toHaveCount(0)
  })

  test('the guest join screen does not, even though the server offers the address', async ({
    donating,
    page,
  }) => {
    const answered = page.waitForResponse((response) => response.url().endsWith('/api/about'))

    await page.goto(donating.url('/join'))
    await answered
    // The footer is the guest screens' common element: it is up, so the layout has rendered.
    await expect(page.getByRole('contentinfo')).toBeVisible()
    await flushed(page)

    await expect(supportLinks(page)).toHaveCount(0)
    await expect(page.getByText(fr.about.supportNoCounterpart)).toHaveCount(0)
  })

  test('the guest upload screen does not, after joining', async ({ donating, surfaces }) => {
    const event = await donating.seedEvent({ slug: 'sans-don', name: 'Camille & Sacha' })
    const { guest } = surfaces

    await guest.goto(donating.url(`/join/${event.joinCode}`))
    await guest.getByRole('button', { name: /Rejoindre/i }).click()
    await guest.waitForURL(/\/e\/[^/]+\/upload/)
    await expect(guest.getByRole('contentinfo')).toBeVisible()
    await flushed(guest)

    await expect(supportLinks(guest)).toHaveCount(0)
    await expect(guest.getByText(fr.about.supportNoCounterpart)).toHaveCount(0)
  })

  test('the shared gallery does not', async ({ donating, page }) => {
    const answered = page.waitForResponse((response) => response.url().endsWith('/api/about'))

    await page.goto(donating.url('/g/not-a-real-token'))
    await answered
    await expect(page.getByRole('contentinfo')).toBeVisible()
    await flushed(page)

    await expect(supportLinks(page)).toHaveCount(0)
  })

  test('the projected wall does not, because nobody in that room is the one being asked', async ({
    donating,
    surfaces,
  }) => {
    const event = await donating.seedEvent({ slug: 'mur-sans-don', name: 'Camille & Sacha' })

    await surfaces.projector.goto(donating.url(`/e/${event.slug}/display`))
    await expect(surfaces.projector.getByTestId('wall-empty')).toBeVisible()
    await flushed(surfaces.projector)

    await expect(supportLinks(surfaces.projector)).toHaveCount(0)
    await expect(surfaces.projector.getByText(fr.about.supportNoCounterpart)).toHaveCount(0)
    await expect(surfaces.projector.getByRole('contentinfo')).toHaveCount(0)
  })

  test('a host who has closed an event is offered it once, and closing the card keeps it closed across a reload', async ({
    donating,
    surfaces,
  }) => {
    const event = await donating.seedEvent({ slug: 'apres-la-fete', name: 'Camille & Sacha' })
    const { host } = surfaces
    const card = host.getByText(fr.about.supportNoCounterpart)

    await host.goto(donating.url(`/admin/events/${event.slug}`))
    // Live: the evening is in use, and nothing is asked.
    await expect(host.getByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    await expect(card).toHaveCount(0)

    await host.getByRole('button', { name: fr.admin.closeEvent }).click()

    await expect(card).toBeVisible()
    // Not a dialog: the album download beside it is still there to be pressed.
    await expect(host.getByRole('dialog')).toHaveCount(0)
    await expect(host.getByRole('link', { name: fr.admin.download })).toBeVisible()

    await host.getByRole('button', { name: fr.about.supportDismiss }).click()
    await expect(card).toHaveCount(0)

    await host.reload()
    await expect(host.getByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    // The event is still closed after the reload, so the card is absent because it was
    // closed and not because the page is in another state.
    await expect(host.getByRole('button', { name: fr.admin.reopenEvent })).toBeVisible()
    // And `GET /api/about` has been answered: the footer's own support link is built from the
    // same response, so once it is up the card's absence is about the answer, not the wait.
    await expect(host.getByRole('link', { name: new RegExp(fr.about.supportLink) })).toBeVisible()
    await flushed(host)
    await expect(card).toHaveCount(0)
  })
})
