import { expect, test, type Page } from '@playwright/test'
import { aClientAccount, createLiveEvent } from '../fixtures/clients'
import {
  currentStep,
  enrolOperator,
  HOSTED,
  totp,
  type OperatorFactor,
} from '../fixtures/operatorFactor'
import { startTestApp, type TestApp } from '../fixtures/startTestApp'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The operator's console, end to end (roadmap §10.4; free plan G2-15, paid plan P3-16): the
 * maintainer, in a browser, on the hosted instance's configuration.
 *
 * One journey, because it is one person's evening. The operator signs in with their password and
 * the code from their authenticator, opens the console from the account menu, reads the box's
 * clients, suspends one, and lifts the suspension: a real server, a real SQLite file, the real
 * session store, a real TOTP check (the spec's authenticator shares no line with the product's:
 * `fixtures/operatorFactor.ts`), the real bundle.
 *
 * What only this ring can show:
 *
 * - **The step-up is one prompt for a session of writes.** The first write meets `403
 *   auth.stepUpRequired`, the prompt opens, a recovery code confirms it and the write goes
 *   through; the second write, a minute later in the same session, opens no prompt at all.
 * - **A suspension takes a client's wall off the public, and lifting it brings it back**, seen from
 *   a stranger's side of the wall's own route, which the console never touches.
 * - **The console is blind to what a client made.** While the operator navigates it, not one
 *   request leaves for `/api/events/*` or `/api/gallery*`, no `<img>` or `<video>` is ever in the
 *   page, and neither the slug, nor the join code, nor the name of the client's live event is
 *   anywhere in what is shown (the tenant-isolation criterion of P3-16).
 */

const EVENT_NAME = 'Mariage Marguerite-et-Anselme'
const EVENT_SLUG = 'mariage-marguerite-et-anselme'

/** A path nobody wrote under `/api/events`: what a stranger is told about an event that is not there. */
const UNKNOWN_WALL = '/api/events/personne-ne-lit-ceci/wall'

test.describe('the operator’s console', () => {
  let app: TestApp
  let factor: OperatorFactor
  let clientName: string
  let joinCode: string

  // eslint-disable-next-line no-empty-pattern -- Playwright reads the first parameter's destructuring to know which fixtures are wanted, so it has to be a pattern even when it is empty.
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-desktop',
      'One project is enough: the console is a laptop screen, and each project boots a server of its own',
    )
  })

  // eslint-disable-next-line no-empty-pattern -- same reason as the beforeEach above.
  test.beforeAll(async ({}, testInfo) => {
    app = await startTestApp({ worker: testInfo.workerIndex, env: HOSTED })

    // A client that holds a live event, made before the operator has an authenticator: the helper
    // signs the operator in over the API with the password alone, as a box that has not asked for
    // a second factor yet would let it.
    const client = await aClientAccount(app, { maxEvents: 3 })
    const event = await createLiveEvent(client, { name: EVENT_NAME, slug: EVENT_SLUG })
    joinCode = event.joinCode
    clientName = `Atelier ${client.email}`

    factor = await enrolOperator(app)
  })

  test.afterAll(async () => {
    await app.dispose()
  })

  /** The operator's own sign-in, through the real form: the password, then the code. */
  const signIn = async (page: Page): Promise<void> => {
    await page.goto(app.url('/login'))
    await page.getByLabel(fr.auth.email).fill(app.owner.email)
    await page.getByLabel(fr.auth.password).fill(app.owner.password)
    await page.getByRole('button', { name: fr.auth.submit }).click()

    // The password was right and no session exists yet: the page asks for the code. The step after
    // the one the enrolment spent, taken now.
    await page.getByLabel(fr.auth.secondFactorCode).fill(totp(factor.secret, currentStep() + 1))
    await page.getByRole('button', { name: fr.auth.secondFactorSubmit }).click()
    // Not `/admin/password`: a session stuck behind the forced rotation would satisfy a looser wait.
    await page.waitForURL(/\/admin(?:\/(?!password))?/)
  }

  const noContentOnScreen = async (page: Page): Promise<void> => {
    await expect(page.locator('img, video, picture, canvas, audio')).toHaveCount(0)
    const body = page.locator('body')
    await expect(body).not.toContainText(EVENT_SLUG)
    await expect(body).not.toContainText(EVENT_NAME)
    await expect(body).not.toContainText(joinCode)
  }

  test('an operator signs in with their authenticator, reads the clients, suspends one and lifts it, and the console never touches what the client made', async ({
    page,
    request,
  }) => {
    await signIn(page)

    // ---- into the console, from the account menu -------------------------------------

    await page.getByRole('button', { name: fr.auth.accountMenu }).click()

    // From here on, every request the console makes is on the record. The dashboard the sign-in
    // landed on read the operator's own events, and that is not the console.
    const paths: string[] = []
    page.on('request', (made) => {
      const url = new URL(made.url())
      if (url.pathname.startsWith('/api/')) paths.push(url.pathname)
    })

    await page.getByRole('link', { name: fr.site.menuLink }).click()
    await expect(page.getByRole('heading', { level: 1, name: fr.site.clientsTitle })).toBeVisible()
    await expect(page.getByText(fr.site.consoleIntro)).toBeVisible()

    // ---- the overview: shapes and sizes ---------------------------------------------

    const row = page.getByRole('row', { name: new RegExp(clientName) })
    await expect(row).toBeVisible()
    await expect(row.getByText(fr.site.statusActive)).toBeVisible()
    await noContentOnScreen(page)

    // The client's public wall answers while the client is in good standing.
    expect((await request.get(app.url(`/api/events/${EVENT_SLUG}/wall`))).status()).toBe(200)

    // ---- the client's own page: its event as a shape ---------------------------------

    await row.getByRole('link', { name: clientName }).click()
    await expect(page.getByRole('heading', { level: 1, name: clientName })).toBeVisible()
    await expect(page.getByRole('table', { name: fr.site.eventsTableLabel })).toBeVisible()
    await expect(page.getByText(fr.site.eventStatuses.live)).toBeVisible()
    await noContentOnScreen(page)

    // ---- the first write: a confirmation is asked for, once --------------------------

    await page.getByRole('button', { name: fr.site.suspend }).click()
    const confirmation = page.getByRole('dialog', { name: fr.site.suspendTitle })
    await expect(confirmation).toContainText(fr.site.suspendBody)
    await confirmation.getByRole('button', { name: fr.site.suspend }).click()

    const prompt = page.getByRole('dialog', { name: fr.site.stepUpTitle })
    await expect(prompt).toBeVisible()
    await prompt.getByLabel(fr.auth.password).fill(app.owner.password)
    // A recovery code: it confirms a step-up as well as an app's code does, and it is what a
    // spec uses for the third code in a row, which the window of the clock cannot give.
    await prompt.getByRole('button', { name: fr.auth.secondFactorRecoveryToggle }).click()
    await prompt.getByLabel(fr.auth.recoveryCode).fill(factor.recoveryCodes[0] ?? '')
    await prompt.getByRole('button', { name: fr.auth.stepUpSubmit }).click()

    // The very write that was refused went through on that confirmation.
    await expect(page.getByText(fr.site.suspended)).toBeVisible()
    await expect(page.getByText(fr.site.statusSuspended).first()).toBeVisible()
    await expect(page.getByRole('button', { name: fr.site.resume })).toBeVisible()

    // The public wall is gone, exactly as an event that was never there.
    const wall = await request.get(app.url(`/api/events/${EVENT_SLUG}/wall`))
    const nothing = await request.get(app.url(UNKNOWN_WALL))
    expect(wall.status()).toBe(404)
    expect(await wall.json()).toEqual(await nothing.json())

    // ---- the second write: no prompt, because the session was confirmed a moment ago -----

    await page.getByRole('button', { name: fr.site.resume }).click()
    await page
      .getByRole('dialog', { name: fr.site.resumeTitle })
      .getByRole('button', { name: fr.site.resume })
      .click()

    await expect(page.getByText(fr.site.resumed)).toBeVisible()
    await expect(page.getByRole('button', { name: fr.site.suspend })).toBeVisible()
    await expect(page.getByRole('dialog', { name: fr.site.stepUpTitle })).toHaveCount(0)
    expect((await request.get(app.url(`/api/events/${EVENT_SLUG}/wall`))).status()).toBe(200)

    // ---- the log says both, in words --------------------------------------------------

    await page.getByRole('link', { name: fr.site.navAudit }).click()
    await expect(page.getByText(fr.site.actions['client.suspended'])).toBeVisible()
    await expect(page.getByText(fr.site.actions['client.resumed'])).toBeVisible()
    await noContentOnScreen(page)

    // ---- and all of it without the console ever asking for what a client made -----------

    expect(paths.some((path) => path.startsWith('/api/site/'))).toBe(true)
    expect(paths.filter((path) => /^\/api\/(events|gallery)/.test(path))).toEqual([])
  })

  test('an operator who has not enrolled is sent to enrol, and is not shown a console of refusals', async ({
    page,
  }, testInfo) => {
    // Its own box: the one above has an operator who enrolled. Here the box requires a second
    // factor of an operator who has none yet, so the password alone opens a session that every
    // `/api/site` route refuses (`403 auth.secondFactorRequired`), and the console says what
    // to do about it instead of listing the refusals.
    const fresh = await startTestApp({ worker: testInfo.workerIndex, env: HOSTED })
    try {
      await page.goto(fresh.url('/login'))
      await page.getByLabel(fr.auth.email).fill(fresh.owner.email)
      await page.getByLabel(fr.auth.password).fill(fresh.owner.password)
      await page.getByRole('button', { name: fr.auth.submit }).click()
      await page.waitForURL(/\/admin(?:\/(?!password))?/)

      await page.goto(fresh.url('/admin/site'))

      await expect(page.getByRole('heading', { name: fr.site.factorTitle })).toBeVisible()
      await expect(page.getByText(fr.site.factorEnrol)).toBeVisible()
      await expect(page.getByRole('heading', { level: 1, name: fr.site.clientsTitle })).toHaveCount(
        0,
      )
      await expect(page.getByRole('alert')).toHaveCount(0)

      await page.getByRole('link', { name: fr.site.factorEnrolLink }).click()
      await expect(page).toHaveURL(/\/admin\/security$/)
    } finally {
      await fresh.dispose()
    }
  })
})
