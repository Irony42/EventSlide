import { test as base, type APIRequestContext, type Page } from '@playwright/test'
import { expect, openSurfaces, test as stock, type Surfaces } from '../fixtures/app'
import { startTestApp, type TestApp } from '../fixtures/startTestApp'
import { fr } from '../../../web/src/lib/i18n/fr'
import type { About } from '../../../web/src/lib/api/dto'

/**
 * The operator's identity, their legal pages and the "Signaler un contenu" link, on a real
 * server and a real bundle (roadmap G2-17 / P3-18, ring 6).
 *
 * The product claim is a boundary, and ring 5 holds it in jsdom: **the report link is on the
 * guests' screens and nowhere a host or the room is; the help page is on the host's; the
 * legal three are on every footer; and the guest's privacy notice names whoever hosts the
 * photograph.** What only this ring can show is the same thing from the production route
 * table behind a real browser, with a server booted with the seven keys set — so every
 * address and name on screen can only have come from `GET /api/about` and the join response —
 * and the second half of the promise, the one a self-hoster relies on: a stock server shows
 * none of it.
 *
 * `REPORT_URL` is a **path**, `/legal/signaler`, exactly as the hosted instance sets it (its
 * reverse proxy serves `/legal/*` ahead of this application), so the journey also shows that
 * a path on the site reaches the `href` as the path it is.
 *
 * Making `HostLayout` render the report link, or `GuestLayout` drop it, turns the host and
 * guest cases red. Refusing a bad address at boot is ring 3's (`env.test.ts`).
 */

const OPERATOR = 'Association Les Photographes'
const CONTACT = 'contact@hosted.example.org'
const TERMS = 'https://hosted.example.org/legal/cgu'
const PRIVACY = 'https://hosted.example.org/legal/confidentialite'
const NOTICE = '/legal/mentions'
const SUPPORT = '/legal/avant-evenement'
const REPORT = '/legal/signaler'

/** Worker-scoped: one server with all seven keys set, shared by every case in the file. */
const operating = base.extend<{ surfaces: Surfaces }, { hosted: TestApp }>({
  hosted: [
    // Playwright parses this parameter list to work out which fixtures the function depends
    // on, so the first argument must be a destructuring pattern even when empty — see the
    // note on `test` in fixtures/app.ts.
    // eslint-disable-next-line no-empty-pattern -- Playwright's API requires it, see above.
    async ({}, use, workerInfo) => {
      const app = await startTestApp({
        worker: workerInfo.workerIndex,
        env: {
          OPERATOR_NAME: OPERATOR,
          OPERATOR_CONTACT_EMAIL: CONTACT,
          LEGAL_TERMS_URL: TERMS,
          LEGAL_PRIVACY_URL: PRIVACY,
          LEGAL_NOTICE_URL: NOTICE,
          SUPPORT_URL: SUPPORT,
          REPORT_URL: REPORT,
        },
      })
      await use(app)
      await app.dispose()
    },
    { scope: 'worker' },
  ],

  surfaces: async ({ browser, hosted }, use) => {
    const surfaces = await openSurfaces(browser, hosted)
    await use(surfaces)
    await surfaces.dispose()
  },
})

const footer = (page: Page) => page.getByRole('contentinfo')
const reportLink = (page: Page) =>
  footer(page).getByRole('link', { name: new RegExp(fr.about.reportLink) })

/**
 * Two animation frames: enough for a response that has already arrived to reach the screen,
 * and not a wait on a clock. An absence asserted before this would be an absence of a page
 * that had not yet heard the answer — the build-time default has no operator link either, so
 * "nothing is shown" is true of a page that is merely early (see `donation-links.spec.ts`).
 */
const flushed = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )

/** Joins as a guest and lands on the upload screen, which is where the notice stands. */
const joinAndUpload = async (page: Page, app: TestApp, joinCode: string): Promise<void> => {
  await page.goto(app.url(`/join/${joinCode}`))
  await page.getByRole('button', { name: /Rejoindre/i }).click()
  await page.waitForURL(/\/e\/[^/]+\/upload/)
}

const aboutOf = async (request: APIRequestContext, app: TestApp): Promise<About> =>
  (await (await request.get(app.url('/api/about'))).json()) as About

operating.describe('an instance whose operator named themselves', () => {
  operating(
    'GET /api/about publishes the operator and the five pages, and only because they were set @smoke',
    async ({ hosted, request }) => {
      const about = await aboutOf(request, hosted)

      expect(about.operator).toEqual({ name: OPERATOR, contactEmail: CONTACT })
      expect(about.links).toEqual({
        terms: TERMS,
        privacy: PRIVACY,
        legalNotice: NOTICE,
        support: SUPPORT,
        report: REPORT,
      })
    },
  )

  operating(
    'the join screen carries "Signaler un contenu", pointing at the path',
    async ({ hosted, page }) => {
      await page.goto(hosted.url('/join'))

      await expect(reportLink(page)).toHaveAttribute('href', REPORT)
      // A tab of its own, so a guest who brushes it mid-send keeps their send.
      await expect(reportLink(page)).toHaveAttribute('target', '_blank')
      await expect(reportLink(page)).toHaveAttribute('rel', /noopener/)
    },
  )

  operating(
    'the guest upload screen carries it too, under the composer',
    async ({ hosted, surfaces }) => {
      const event = await hosted.seedEvent({ slug: 'signalement', name: 'Camille & Sacha' })

      await joinAndUpload(surfaces.guest, hosted, event.joinCode)

      await expect(reportLink(surfaces.guest)).toHaveAttribute('href', REPORT)
    },
  )

  operating('the shared gallery carries it', async ({ hosted, page }) => {
    await page.goto(hosted.url('/g/not-a-real-token'))

    await expect(reportLink(page)).toHaveAttribute('href', REPORT)
  })

  operating(
    'the host console does not, and carries the help page instead',
    async ({ hosted, surfaces }) => {
      await surfaces.host.goto(hosted.url('/admin'))

      await expect(
        footer(surfaces.host).getByRole('link', { name: new RegExp(fr.about.helpLink) }),
      ).toHaveAttribute('href', SUPPORT)
      await expect(reportLink(surfaces.host)).toHaveCount(0)
    },
  )

  operating(
    'every footer carries the terms, the privacy policy and the legal notice',
    async ({ hosted, surfaces, page }) => {
      for (const target of [
        { page, path: '/join' },
        { page: surfaces.host, path: '/admin' },
      ]) {
        await target.page.goto(hosted.url(target.path))
        const links = footer(target.page)

        await expect(
          links.getByRole('link', { name: new RegExp(fr.about.termsLink) }),
        ).toHaveAttribute('href', TERMS)
        await expect(
          links.getByRole('link', { name: new RegExp(fr.about.privacyLink) }),
        ).toHaveAttribute('href', PRIVACY)
        await expect(
          links.getByRole('link', { name: new RegExp(fr.about.legalNoticeLink) }),
        ).toHaveAttribute('href', NOTICE)
      }
    },
  )

  operating('/about names the operator and offers their address', async ({ hosted, page }) => {
    await page.goto(hosted.url('/about'))

    await expect(page.getByRole('heading', { name: fr.about.operatorTitle })).toBeVisible()
    await expect(page.getByText(OPERATOR)).toBeVisible()
    await expect(page.getByRole('link', { name: CONTACT })).toHaveAttribute(
      'href',
      `mailto:${CONTACT}`,
    )
  })

  operating(
    'the guest’s notice says who hosts the photograph, and links the policy',
    async ({ hosted, surfaces }) => {
      const event = await hosted.seedEvent({ slug: 'heberge-par', name: 'Camille & Sacha' })

      await joinAndUpload(surfaces.guest, hosted, event.joinCode)

      const notice = surfaces.guest.getByRole('region', { name: fr.upload.noticeTitle })
      await expect(notice.getByText(fr.about.operatorHostedBy)).toBeVisible()
      await expect(notice.getByText(OPERATOR)).toBeVisible()
      await expect(
        notice.getByRole('link', { name: new RegExp(fr.about.privacyLink) }),
      ).toHaveAttribute('href', PRIVACY)

      // And the notice that names the operator is one a guest can actually acknowledge: the
      // join, the read and the acknowledgement must all name the same operator, or the
      // acknowledgement answers 409 and the guest is asked again for ever.
      const recorded = surfaces.guest.waitForResponse((response) =>
        response.url().endsWith('/privacy-notice/acknowledgement'),
      )
      await notice.getByRole('button', { name: fr.upload.noticeAcknowledge }).click()
      expect((await recorded).status()).toBe(200)
      await expect(surfaces.guest.getByTestId('photo-input')).toBeAttached()
      await expect(surfaces.guest.getByTestId('privacy-notice')).toHaveCount(0)
    },
  )

  operating(
    'the projected wall has no footer and so no link to anything',
    async ({ hosted, surfaces }) => {
      const event = await hosted.seedEvent({ slug: 'mur-sans-lien', name: 'Camille & Sacha' })

      await surfaces.projector.goto(hosted.url(`/e/${event.slug}/display`))
      await expect(surfaces.projector.getByTestId('wall-empty')).toBeVisible()

      await expect(footer(surfaces.projector)).toHaveCount(0)
      await expect(
        surfaces.projector.getByRole('link', { name: new RegExp(fr.about.reportLink) }),
      ).toHaveCount(0)
    },
  )
})

/**
 * The other half of the promise: **an instance that set none of the seven is the instance it
 * always was.** The stock server of every other spec in this suite, asked the same questions.
 */
stock.describe('a stock server, whose operator set nothing', () => {
  stock('GET /api/about names nobody and links to nothing', async ({ app, request }) => {
    const about = await aboutOf(request, app)

    expect(about.operator).toBeUndefined()
    expect(about.links).toEqual({})
  })

  stock(
    'the guest footer has exactly the two links it always had, and no report link',
    async ({ app, page }) => {
      const answered = page.waitForResponse((response) => response.url().endsWith('/api/about'))

      await page.goto(app.url('/join'))
      await answered
      await expect(footer(page)).toBeVisible()
      await flushed(page)

      await expect(footer(page).getByRole('link')).toHaveCount(2)
      await expect(reportLink(page)).toHaveCount(0)
    },
  )

  stock(
    'the guest’s notice says nothing about a host and links no policy',
    async ({ app, surfaces }) => {
      const event = await app.seedEvent({ slug: 'sans-operateur', name: 'Camille & Sacha' })

      await joinAndUpload(surfaces.guest, app, event.joinCode)

      const notice = surfaces.guest.getByRole('region', { name: fr.upload.noticeTitle })
      await expect(notice).toBeVisible()
      // The footer and the notice each ask `/api/about` for themselves; both have been given
      // the chance to answer before an absence is asserted of either.
      await expect(footer(surfaces.guest)).toBeVisible()
      await flushed(surfaces.guest)
      await expect(notice.getByText(fr.about.operatorHostedBy)).toHaveCount(0)
      await expect(notice.getByRole('link')).toHaveCount(0)
    },
  )
})
