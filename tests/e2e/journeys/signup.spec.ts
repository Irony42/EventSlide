import { expect, test, type Browser, type Page } from '@playwright/test'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
import { currentStep, enrolOperator, totp, type OperatorFactor } from '../fixtures/operatorFactor'
import { CONTACT, linkIn, mailsTo, startSignupBox, TERMS_VERSION } from '../fixtures/signupBox'
import type { SmtpSink } from '../../../src/infrastructure/mail/testing/smtpSink'
import type { TestApp } from '../fixtures/startTestApp'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * Self-service signup, end to end (spec 31, ADR 0018): a stranger asks for an account on the
 * hosted instance's configuration and ends up in a console of their own.
 *
 * **Its own server per case**, with a real mail relay in this process (as `forgot-password.spec.ts`):
 * the shared server has no relay on purpose, so `features.signup` is `off` there and `/signup`
 * answers that signing up is not open.
 *
 * What only real infrastructure can break: the confirmation link built from `PUBLIC_URL` with the
 * visitor's `?lang=`, the page that acts only on its button (a mail scanner that opens the link
 * confirms nothing), the three flows (`open`, `review`, a request the disk guard holds), the
 * operator's step-up on a write, and the same answer for an address that already has an account.
 */

const CONFIRM_LINK = /https?:\/\/\S+\/signup\/confirm\/[A-Za-z0-9_-]+\?lang=[a-z]{2}/
const INVITE_LINK = /https?:\/\/\S+\/invite\/[A-Za-z0-9_-]{43}/
const CONFIRM_SUBJECT = 'Confirmez votre adresse'
const INVITATION_SUBJECT = ''
const PASSWORD = 'e2e-fixture-signup-chosen-passphrase'

// eslint-disable-next-line no-empty-pattern -- Playwright reads the first parameter's pattern.
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'One project is enough: each case boots a server and a relay of its own',
  )
})

const visitor = async (
  browser: Browser,
  app: TestApp,
): Promise<{ page: Page; close: () => Promise<void> }> => {
  const context = await browser.newContext({ baseURL: app.baseUrl, locale: SUITE_LOCALE })
  return { page: await context.newPage(), close: () => context.close() }
}

const waitFor = async (what: string, read: () => string | null): Promise<string> => {
  await expect.poll(read, { message: what }).not.toBeNull()
  return read() ?? ''
}

/** Fills and sends the form; resolves with the server's answer to it. */
const askForAnAccount = async (
  page: Page,
  app: TestApp,
  who: { email: string; space: string; note?: string },
  path = '/signup?lang=fr',
): Promise<{ status: number; body: string }> => {
  await page.goto(app.url(path))
  await page.getByLabel(fr.auth.email).fill(who.email)
  await page.getByLabel(fr.signup.clientName).fill(who.space)
  if (who.note !== undefined) await page.getByLabel(fr.signup.note).fill(who.note)
  const answered = page.waitForResponse(
    (response) => response.url().endsWith('/api/signup') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: fr.signup.submit }).click()
  const response = await answered
  return { status: response.status(), body: await response.text() }
}

/** The confirmation mail's link for `email`, opened and confirmed with the button. */
const confirmAddress = async (page: Page, sink: SmtpSink, email: string): Promise<void> => {
  const link = await waitFor('the confirmation mail', () =>
    linkIn(sink, email, CONFIRM_SUBJECT, CONFIRM_LINK),
  )
  await page.goto(link)
  await expect(page.getByRole('heading', { name: fr.signup.confirmTitle })).toBeVisible()
  await page.getByRole('button', { name: fr.signup.confirmSubmit }).click()
}

const acceptInvitation = async (page: Page, sink: SmtpSink, email: string, space: string) => {
  const link = await waitFor('the invitation mail', () =>
    linkIn(sink, email, INVITATION_SUBJECT, INVITE_LINK),
  )
  await page.goto(link)
  await expect(page.getByText(fr.auth.invitationToOwn(space), { exact: false })).toBeVisible()
  await page.getByLabel(fr.auth.invitationName).fill('Léa')
  await page.getByLabel(fr.auth.password, { exact: true }).fill(PASSWORD)
  await page.getByLabel(fr.auth.invitationConfirmPassword, { exact: true }).fill(PASSWORD)
  const terms = page.getByLabel(fr.auth.invitationAcceptTerms(TERMS_VERSION))
  if ((await terms.count()) > 0) await terms.check()
  await page.getByRole('button', { name: fr.auth.invitationSubmit }).click()
  await expect(page).toHaveURL(/\/admin/)
  await expect(page.getByRole('button', { name: fr.auth.accountMenu, exact: true })).toBeVisible()
}

/** The operator signs in with the password and the code of their authenticator. */
const signInOperator = async (page: Page, app: TestApp, factor: OperatorFactor): Promise<void> => {
  await page.goto(app.url('/login'))
  await page.getByLabel(fr.auth.email).fill(app.owner.email)
  await page.getByLabel(fr.auth.password).fill(app.owner.password)
  await page.getByRole('button', { name: fr.auth.submit }).click()
  await page.getByLabel(fr.auth.secondFactorCode).fill(totp(factor.secret, currentStep() + 1))
  await page.getByRole('button', { name: fr.auth.secondFactorSubmit }).click()
  await page.waitForURL(/\/admin(?:\/(?!password))?/)
}

/** Answers the step-up prompt a first write meets, with a recovery code. */
const confirmStepUp = async (page: Page, app: TestApp, code: string): Promise<void> => {
  const prompt = page.getByRole('dialog', { name: fr.site.stepUpTitle })
  await expect(prompt).toBeVisible()
  await prompt.getByLabel(fr.auth.password).fill(app.owner.password)
  await prompt.getByRole('button', { name: fr.auth.secondFactorRecoveryToggle }).click()
  await prompt.getByLabel(fr.auth.recoveryCode).fill(code)
  await prompt.getByRole('button', { name: fr.auth.stepUpSubmit }).click()
}

test('mode open: the form, the confirmation, the invitation and the first console, then a welcome mail', async ({
  browser,
}, testInfo) => {
  const box = await startSignupBox(testInfo, { mode: 'open', terms: true })
  const { app, sink } = box
  const { page, close } = await visitor(browser, app)
  const email = 'lea@visiteur.example'
  const space = 'Mariage de Léa et Hugo'

  try {
    // The form is offered because the box says signing up is open.
    const answer = await askForAnAccount(page, app, { email, space, note: 'Un mariage en juin' })
    expect(answer.status).toBe(202)
    await expect(page).toHaveURL(/\/signup\/sent$/)
    await expect(page.getByRole('heading', { name: fr.signup.sentTitle })).toBeVisible()

    // The link carries the language the form was in and the box's own address.
    const link = await waitFor('the confirmation mail', () =>
      linkIn(sink, email, CONFIRM_SUBJECT, CONFIRM_LINK),
    )
    expect(link.startsWith(app.baseUrl)).toBe(true)
    expect(link).toContain('?lang=fr')

    // Opening the link (a mail scanner does it) confirms nothing: only the button does.
    const opened = await page.goto(link)
    expect(opened?.headers()['cache-control']).toBe('no-store')
    expect(opened?.headers()['referrer-policy']).toBe('no-referrer')
    await expect(page.getByRole('heading', { name: fr.signup.confirmTitle })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: fr.signup.confirmSubmit })).toBeVisible()
    expect(mailsTo(sink, email)).toHaveLength(1)

    await page.getByRole('button', { name: fr.signup.confirmSubmit }).click()
    await expect(page.getByRole('heading', { name: fr.signup.mailTitle })).toBeVisible()

    // Spent: the same link says so, and opens nothing a second time.
    await page.goto(link)
    await expect(page.getByRole('heading', { name: fr.signup.spentTitle })).toBeVisible()

    // The invitation, then the account: the first owner of a fresh space.
    await acceptInvitation(page, sink, email, space)

    // And one welcome mail, from the contact address named in it.
    const welcome = await waitFor(
      'the welcome mail',
      () => mailsTo(sink, email).find((mail) => mail.subject.includes('Bienvenue'))?.text ?? null,
    )
    expect(welcome).toContain(CONTACT)
    expect(welcome).toContain(app.url('/legal/avant-evenement'))
  } finally {
    await close()
    await box.close()
  }
})

test('mode review: confirming waits for the operator, who approves one request and refuses another', async ({
  browser,
}, testInfo) => {
  const box = await startSignupBox(testInfo, { mode: 'review' })
  const { app, sink } = box
  const factor = await enrolOperator(app)
  const guest = await visitor(browser, app)
  const refusedGuest = await visitor(browser, app)
  const operator = await visitor(browser, app)
  const first = { email: 'camille@visiteur.example', space: 'Association Les Pieds Agiles' }
  const second = { email: 'sacha@visiteur.example', space: 'Anniversaire de Sacha' }

  try {
    await askForAnAccount(guest.page, app, first)
    await confirmAddress(guest.page, sink, first.email)
    await expect(guest.page.getByRole('heading', { name: fr.signup.reviewTitle })).toBeVisible()
    await askForAnAccount(refusedGuest.page, app, second)
    await confirmAddress(refusedGuest.page, sink, second.email)
    await expect(
      refusedGuest.page.getByRole('heading', { name: fr.signup.reviewTitle }),
    ).toBeVisible()

    // Nothing opened by itself: no invitation, no refusal.
    expect(mailsTo(sink, first.email).map((mail) => mail.subject)).toEqual([
      expect.stringContaining(CONFIRM_SUBJECT),
    ])

    // ---- the operator sees both and approves the first ----------------------------------
    const page = operator.page
    await signInOperator(page, app, factor)
    await page.goto(app.url('/admin/site/signups'))
    await expect(page.getByRole('heading', { name: fr.siteSignups.title })).toBeVisible()
    await expect(page.getByRole('link', { name: fr.siteSignups.navPending(2) })).toBeVisible()
    const row = (space: string) => page.getByRole('row', { name: new RegExp(space) })
    await expect(row(first.space)).toContainText(first.email)

    await row(first.space).getByRole('button', { name: fr.siteSignups.approve }).click()
    const approval = page.getByRole('dialog', { name: fr.siteSignups.approveTitle(first.space) })
    await approval.getByRole('button', { name: fr.siteSignups.approveConfirm }).click()
    await confirmStepUp(page, app, factor.recoveryCodes[0] ?? '')
    await expect(page.getByText(fr.siteSignups.approvedDone(first.space))).toBeVisible()

    // The invitation reached the person, who accepts it and lands in their console.
    await acceptInvitation(guest.page, sink, first.email, first.space)

    // ---- the operator refuses the second, telling the person, with no second prompt -----
    await page.goto(app.url('/admin/site/signups'))
    await row(second.space).getByRole('button', { name: fr.siteSignups.refuse }).click()
    const refusal = page.getByRole('dialog', { name: fr.siteSignups.refuseTitle(second.space) })
    await expect(refusal.getByLabel(fr.siteSignups.notify)).toBeChecked()
    await refusal.getByRole('button', { name: fr.siteSignups.refuseConfirm }).click()
    await expect(page.getByRole('dialog', { name: fr.site.stepUpTitle })).toHaveCount(0)
    await expect(page.getByText(fr.siteSignups.refusedDone)).toBeVisible()

    const refusedMail = await waitFor(
      'the refusal mail',
      () =>
        mailsTo(sink, second.email).find(
          (mail) => mail.subject === 'Votre demande de compte EventSlide',
        )?.text ?? null,
    )
    expect(refusedMail).not.toContain('/invite/')
    expect(mailsTo(sink, second.email).some((mail) => INVITE_LINK.test(mail.text))).toBe(false)
  } finally {
    await Promise.all([guest.close(), refusedGuest.close(), operator.close()])
    await box.close()
  }
})

test('an address that already has an account gets the same answer and the same mail as a new one', async ({
  browser,
}, testInfo) => {
  const box = await startSignupBox(testInfo, { mode: 'open' })
  const { app, sink } = box
  const { page, close } = await visitor(browser, app)
  const fresh = 'nouveau@visiteur.example'

  try {
    // The bootstrap owner is an account the box knows.
    const known = await askForAnAccount(page, app, {
      email: app.owner.email,
      space: 'Espace connu',
    })
    await expect(page.getByRole('heading', { name: fr.signup.sentTitle })).toBeVisible()
    const unknown = await askForAnAccount(page, app, { email: fresh, space: 'Espace neuf' })
    await expect(page.getByRole('heading', { name: fr.signup.sentTitle })).toBeVisible()

    expect(known).toEqual(unknown)
    expect(known.status).toBe(202)

    const [knownMail] = mailsTo(sink, app.owner.email)
    const [freshMail] = mailsTo(sink, fresh)
    expect(knownMail).toBeDefined()
    expect(freshMail).toBeDefined()
    expect(knownMail?.subject).toBe(freshMail?.subject)
    const bare = (text: string | undefined): string => (text ?? '').replace(CONFIRM_LINK, '<link>')
    expect(bare(knownMail?.text)).toBe(bare(freshMail?.text))
    expect(bare(knownMail?.text)).toContain('<link>')
  } finally {
    await close()
    await box.close()
  }
})

test('past the day’s ceiling the form says to come back tomorrow, and sends nothing', async ({
  browser,
}, testInfo) => {
  const box = await startSignupBox(testInfo, { mode: 'open', env: { SIGNUP_MAX_PER_DAY: '1' } })
  const { app, sink } = box
  const { page, close } = await visitor(browser, app)

  try {
    await askForAnAccount(page, app, { email: 'un@visiteur.example', space: 'Premier' })
    await expect(page.getByRole('heading', { name: fr.signup.sentTitle })).toBeVisible()

    await askForAnAccount(page, app, { email: 'deux@visiteur.example', space: 'Second' })
    await expect(page.getByRole('heading', { name: fr.signup.busyTitle })).toBeVisible()
    await expect(page.getByText(fr.signup.busy)).toBeVisible()
    expect(mailsTo(sink, 'deux@visiteur.example')).toHaveLength(0)
  } finally {
    await close()
    await box.close()
  }
})

test('mode open with too little free disk: the address is confirmed, nothing opens, the operator decides', async ({
  browser,
}, testInfo) => {
  // No hook: a floor no disk can meet is the plain setting an operator would use to stop signups.
  const box = await startSignupBox(testInfo, {
    mode: 'open',
    env: { MIN_FREE_DISK_BYTES: '900000000000000' },
  })
  const { app, sink } = box
  const factor = await enrolOperator(app)
  const guest = await visitor(browser, app)
  const operator = await visitor(browser, app)
  const who = { email: 'attente@visiteur.example', space: 'Fête au village' }

  try {
    await askForAnAccount(guest.page, app, who)
    await confirmAddress(guest.page, sink, who.email)
    await expect(guest.page.getByRole('heading', { name: fr.signup.pendingTitle })).toBeVisible()
    await expect(guest.page.getByText(fr.signup.pendingDone)).toBeVisible()

    // No invitation left: the account did not open.
    expect(mailsTo(sink, who.email)).toHaveLength(1)

    await signInOperator(operator.page, app, factor)
    await operator.page.goto(app.url('/admin/site/signups'))
    await expect(
      operator.page.getByRole('heading', { name: fr.siteSignups.heldHeading }),
    ).toBeVisible()
    await expect(operator.page.getByRole('row', { name: new RegExp(who.space) })).toContainText(
      who.email,
    )
  } finally {
    await Promise.all([guest.close(), operator.close()])
    await box.close()
  }
})
