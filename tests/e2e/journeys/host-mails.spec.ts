import { csrfHeaders, expect, test } from '../fixtures/app'
import { startTestApp } from '../fixtures/startTestApp'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
import { parseMessage, startSmtpSink } from '../../../src/infrastructure/mail/testing/smtpSink'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The mails the box writes to its hosts, from the host's side (spec 32, ADR 0019).
 *
 * **Its own server with a mail relay** (a listener in this process, `smtpSink`): the shared server has no relay on purpose, and
 * on a box with none the page offers no e-mail switch at all (asserted at the end).
 *
 * What only real infrastructure can break, end to end: `features.hostMail` in `/api/about` that makes the section and the menu
 * entry appear, the `PUT /api/me/mail-preferences` the switches send and a reload that reads it back, the replies page that
 * greys its own daily-summary box when the account switched the replies family off, and the one mail a password change
 * sends, with its link built from `PUBLIC_URL`.
 *
 * What it does **not** do, and why: the daily summary and the warning before the replies are erased leave only between 08:00 and
 * 21:00 in the invitation's zone and weeks ahead of a party, and the box has no clock a browser test can move. Their
 * delivery, the absence of any guest's word in them and the family switch are held one ring down, over the real adapters and a
 * clock the test sets (`src/main/hostMails.integration.test.ts`).
 */

const NEW_PASSWORD = 'e2e-fixture-changed-passphrase-for-mails'
const text = fr.auth.mailPreferences

test('a host reads and changes their e-mail switches, sees the replies page follow them, and gets a mail for a new password', async ({
  browser,
}, testInfo) => {
  const sink = await startSmtpSink()
  const app = await startTestApp({
    worker: testInfo.workerIndex,
    env: {
      SMTP_URL: `smtp://127.0.0.1:${sink.port}`,
      MAIL_FROM: 'no-reply@eventslide.test',
      PUBLIC_URL: 'https://photos.example.org',
    },
  }).catch(async (error: unknown) => {
    await sink.close()
    throw error
  })
  const context = await browser.newContext({ baseURL: app.baseUrl, locale: SUITE_LOCALE })

  try {
    const page = await context.newPage()
    await page.goto(app.url('/login'))
    await page.getByLabel(fr.auth.email).fill(app.owner.email)
    await page.getByLabel(fr.auth.password, { exact: true }).fill(app.owner.password)
    await page.getByRole('button', { name: fr.auth.submit }).click()
    await expect(page).toHaveURL(/\/admin$/)

    // ---- the menu offers the page under its new name, the page has the section -------------------

    await page.getByRole('button', { name: fr.auth.accountMenu, exact: true }).click()
    await page.getByRole('link', { name: fr.auth.securityMenu, exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/security$/)
    await expect(page.getByRole('heading', { level: 1, name: fr.auth.securityMenu })).toBeVisible()
    await expect(page).toHaveTitle(new RegExp(fr.titles.security))
    const section = page.getByRole('region', { name: text.title })
    await expect(section).toBeVisible()
    await expect(section.getByText(text.always)).toBeVisible()
    const replies = section.getByRole('checkbox', { name: text.rsvpLabel })
    const events = section.getByRole('checkbox', { name: text.eventLabel })
    await expect(replies).toBeChecked()
    await expect(events).toBeChecked()

    // ---- switching one off is saved, and a reload reads it back -----------------------------------

    await replies.uncheck()
    await expect(section).toHaveAttribute('aria-busy', 'false')
    // Read until the server says so: the box is shown at once, the write is on its way.
    const preferences = async () =>
      (await page.request.get(app.url('/api/me/mail-preferences'))).json()
    await expect.poll(preferences).toEqual({ rsvp: false, event: true, available: true })
    await page.reload()
    await expect(page.getByRole('checkbox', { name: text.rsvpLabel })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: text.eventLabel })).toBeChecked()

    // ---- the replies page follows: its daily summary is greyed, and says why ----------------------

    const headers = await csrfHeaders(page.request, app)
    const event = await app.seedEvent({ slug: 'fete-mails', name: 'Fête des mails' })
    // A party two months ahead of whenever this runs, so the replies are open whatever the date.
    const startsAt = new Date(Date.now() + 60 * 24 * 3_600_000).toISOString()
    const invited = await page.request.put(app.url(`/api/events/${event.slug}/guest-invite`), {
      headers,
      data: { title: 'Fête des mails', startsAt, timeZone: 'Europe/Paris', language: 'fr' },
    })
    expect(invited.ok()).toBe(true)
    const enabled = await page.request.post(
      app.url(`/api/events/${event.slug}/guest-invite/enable`),
      { headers, data: {} },
    )
    expect(enabled.ok()).toBe(true)
    const asked = await page.request.put(app.url(`/api/events/${event.slug}/rsvp-form`), {
      headers,
      data: { enabled: true },
    })
    expect(asked.ok()).toBe(true)
    await page.goto(app.url(`/admin/events/${event.slug}/rsvps`))
    const digest = page.getByRole('checkbox', { name: fr.rsvp.digest.label })
    await expect(digest).toBeDisabled()
    await expect(page.getByText(fr.rsvp.digest.offByAccount)).toBeVisible()

    // ---- switched back on, the box is live and its choice is saved --------------------------------

    await page.goto(app.url('/admin/security'))
    await page.getByRole('checkbox', { name: text.rsvpLabel }).check()
    await expect.poll(preferences).toEqual({ rsvp: true, event: true, available: true })
    await page.goto(app.url(`/admin/events/${event.slug}/rsvps`))
    await expect(digest).toBeEnabled()
    await digest.click()
    await expect(digest).toBeChecked()
    await expect(page.getByText(fr.rsvp.digest.failed)).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('checkbox', { name: fr.rsvp.digest.label })).toBeChecked()

    // ---- changing the password sends a mail, with the way to recover the account --------

    expect(sink.messages).toHaveLength(0)
    await page.goto(app.url('/admin/password'))
    await page.getByLabel(fr.auth.currentPassword, { exact: true }).fill(app.owner.password)
    await page.getByLabel(fr.auth.newPassword, { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel(fr.auth.confirmPassword, { exact: true }).fill(NEW_PASSWORD)
    await page.getByRole('button', { name: fr.app.save }).click()
    await expect(page.getByText(fr.auth.passwordSaved)).toBeVisible()

    await expect.poll(() => sink.messages.length).toBe(1)
    const message = sink.messages[0]
    const parsed = parseMessage(message?.raw ?? '')
    expect(message?.envelopeTo).toEqual([app.owner.email])
    expect(parsed.subject).toBe('Votre mot de passe EventSlide a été changé')
    expect(parsed.text ?? '').toContain('https://photos.example.org/password/forgot')
    expect(parsed.text ?? '').not.toContain(NEW_PASSWORD)
  } finally {
    await context.close()
    await app.dispose()
    await sink.close()
  }
})

test('a box with no mail relay has no e-mail section and no menu entry for a host with no second-factor key', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const answered = host.waitForResponse((response) =>
    response.url().endsWith('/api/me/mail-preferences'),
  )
  await host.goto(app.url('/admin/security'))
  const served = await answered
  expect(((await served.json()) as { available: boolean }).available).toBe(false)

  await expect(host.getByRole('heading', { level: 1, name: fr.auth.securityMenu })).toBeVisible()
  await expect(host.getByRole('heading', { name: text.title, exact: true })).toHaveCount(0)
  await expect(host.getByRole('checkbox')).toHaveCount(0)
})
