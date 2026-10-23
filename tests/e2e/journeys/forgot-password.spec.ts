import { csrfHeaders, expect, test } from '../fixtures/app'
import { startTestApp } from '../fixtures/startTestApp'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
import { parseMessage, startSmtpSink } from '../../../src/infrastructure/mail/testing/smtpSink'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A host who has lost their password asks for a link, chooses a new one with it, and signs in
 * (docs/ROADMAP.md §10.3; free plan G2-08 and G2-10, paid plan P3-09 and P3-11).
 *
 * **Its own server**, because the shared one is started with no mail relay on purpose — so that
 * every spec that copies an invitation link sees what a self-hoster with no SMTP sees — and
 * `features.forgotPassword` is therefore `false` there and the sign-in page offers no such link.
 * Here the box is started with a relay: a real TCP listener in this process, speaking enough
 * SMTP for the adapter to hand it a message, which is also what the mail ends up in.
 *
 * What only real infrastructure can break, end to end: the `/api/about` flag that makes the
 * link appear, the SPA fallback that serves `/password/forgot` and `/password/reset/<token>`,
 * the mail that carries a link built from `PUBLIC_URL`, the one-hour link that works once, and
 * the credentials epoch that closes the sessions the old password had.
 */

const NEW_PASSWORD = 'e2e-fixture-forgotten-then-chosen-passphrase'

test('a host who forgot their password asks for a link, chooses a new one with it, and signs in', async ({
  browser,
}, testInfo) => {
  const sink = await startSmtpSink()
  const app = await startTestApp({
    worker: testInfo.workerIndex,
    env: { SMTP_URL: `smtp://127.0.0.1:${sink.port}`, MAIL_FROM: 'no-reply@eventslide.test' },
  })
  const context = await browser.newContext({ baseURL: app.baseUrl, locale: SUITE_LOCALE })

  try {
    const page = await context.newPage()

    // ---- the sign-in page offers the way back in, because this box can mail ------------

    await page.goto(app.url('/login'))
    await page.getByRole('link', { name: fr.auth.forgotLink }).click()
    await expect(page).toHaveURL(/\/password\/forgot$/)

    // ---- asking: the same answer whoever is asked about ---------------------------------

    await page.getByLabel(fr.auth.email).fill(app.owner.email)
    await page.getByRole('button', { name: fr.auth.forgotSubmit }).click()
    await expect(page.getByRole('heading', { name: fr.auth.forgotSentTitle })).toBeVisible()
    await expect(page.getByText(fr.auth.forgotSent)).toBeVisible()

    // ---- the mail, and the link in it ---------------------------------------------------

    await expect.poll(() => sink.messages.length).toBe(1)
    const text = parseMessage(sink.messages[0]?.raw ?? '').text ?? ''
    const link = /https?:\/\/\S+\/password\/reset\/[A-Za-z0-9_-]+/.exec(text)?.[0]
    expect(link, 'the mail carries a reset link').toBeDefined()
    const reset = link ?? ''
    expect(reset.startsWith(app.baseUrl)).toBe(true)

    // ---- choosing: on the page the link opens, which keeps the token where it was put ---

    const opened = await page.goto(reset)
    expect(opened?.status()).toBe(200)
    expect(opened?.headers()['cache-control']).toBe('no-store')
    expect(opened?.headers()['x-robots-tag']).toBe('noindex, nofollow')
    expect(opened?.headers()['referrer-policy']).toBe('no-referrer')
    expect(await page.title()).not.toContain(reset.split('/').at(-1) ?? 'x')

    await page.getByLabel(fr.auth.newPassword, { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel(fr.auth.confirmPassword, { exact: true }).fill(NEW_PASSWORD)
    await page.getByRole('button', { name: fr.auth.resetSubmit }).click()
    await expect(page.getByRole('heading', { name: fr.auth.resetDoneTitle })).toBeVisible()

    // ---- the link works once ------------------------------------------------------------

    await page.goto(reset)
    await page.getByLabel(fr.auth.newPassword, { exact: true }).fill(`${NEW_PASSWORD}-bis`)
    await page.getByLabel(fr.auth.confirmPassword, { exact: true }).fill(`${NEW_PASSWORD}-bis`)
    await page.getByRole('button', { name: fr.auth.resetSubmit }).click()
    await expect(page.getByRole('heading', { name: fr.auth.deadLinkTitle })).toBeVisible()
    await expect(page.getByText(fr.errors['auth.invalidToken'])).toBeVisible()

    // ---- the old password no longer opens the account; the new one does -----------------

    const refused = await context.request.post(app.url('/api/auth/login'), {
      headers: await csrfHeaders(context.request, app),
      data: { email: app.owner.email, password: app.owner.password },
    })
    expect(refused.status()).toBe(401)

    await page.goto(app.url('/login'))
    await page.getByLabel(fr.auth.email).fill(app.owner.email)
    await page.getByLabel(fr.auth.password, { exact: true }).fill(NEW_PASSWORD)
    await page.getByRole('button', { name: fr.auth.submit }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('button', { name: fr.auth.accountMenu })).toBeVisible()

    // ---- and out again, from the menu that had no caller before this ---------------------

    await page.getByRole('button', { name: fr.auth.accountMenu }).click()
    await page.getByRole('button', { name: fr.auth.logout }).click()
    await expect(page).toHaveURL(/\/login$/)
    const afterwards = await context.request.get(app.url('/api/auth/me'))
    expect(await afterwards.json()).toEqual({ authenticated: false })
  } finally {
    await context.close()
    await app.dispose()
    await sink.close()
  }
})

test('a box with no mail relay offers no way to ask, and says so if asked anyway', async ({
  app,
  browser,
}) => {
  // The shared server has no `SMTP_URL`, by design: this is what a self-hoster with no relay sees.
  const context = await browser.newContext({ baseURL: app.baseUrl, locale: SUITE_LOCALE })
  try {
    const page = await context.newPage()

    await page.goto(app.url('/login'))
    await expect(page.getByLabel(fr.auth.email)).toBeVisible()
    // Let `/api/about` answer before asserting an absence.
    await page.waitForResponse((response) => response.url().endsWith('/api/about'))
    await expect(page.getByRole('link', { name: fr.auth.forgotLink })).toHaveCount(0)

    // A bookmark or an old mail can still land on the page: the server is the judge.
    await page.goto(app.url('/password/forgot'))
    await page.getByLabel(fr.auth.email).fill('quelqu-un@example.org')
    await page.getByRole('button', { name: fr.auth.forgotSubmit }).click()
    await expect(page.getByRole('alert')).toContainText(fr.auth.forgotUnavailable)
  } finally {
    await context.close()
  }
})
