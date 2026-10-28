import { csrfHeaders, expect, test } from '../fixtures/app'
import { tokenOf } from '../fixtures/clients'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host hands the console to somebody else by **a link**, and that somebody makes their
 * account by opening it (docs/ROADMAP.md §10.3; free plan G2-09 and G2-10, paid plan P3-10 and
 * P3-11).
 *
 * What this replaced is a password read out loud: the host typed a credential, the box created
 * an account with it, and the invitee signed in with it and was forced to change it. That
 * journey is gone, and so is its shape — **no account exists until the link is accepted**, the
 * person chooses their own password in the same step, and nothing about the invitation says
 * whether the address was already on the box.
 *
 * Two browser contexts, because it is two people: the host's laptop and the moderator's own
 * machine, with its own cookie jar. The e2e box has no mail relay, so the invitation comes back
 * as a link the host copies — which is exactly what a self-hoster with no SMTP sees. The invitee
 * opens it **in the browser**, on the page G2-10 added (`/invite/:token`), chooses a name and a
 * password there, and arrives on the event: an invitation, a bcrypt hash, a session, a
 * membership and the SPA fallback that serves the page, end to end.
 */

const CHOSEN_PASSWORD = 'phrase-que-seul-le-moderateur-connait'

test('a moderator invited by link accepts it on their own machine and can moderate the event', async ({
  app,
  browser,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'invitation', name: 'Camille & Sacha' })
  // Scoped to the worker: the server outlives this test, and an address that already has an
  // account is told to sign in instead of being given a second one.
  const moderator = `moderateur-${app.baseUrl.split(':').at(-1) ?? '0'}@eventslide.test`

  await host.goto(app.url(`/admin/events/${event.slug}`))

  // ---- the host invites: an address, and nothing else ------------------------------

  await host.getByLabel(fr.admin.moderatorEmail).fill(moderator)
  await host.getByRole('button', { name: fr.admin.inviteSubmit }).click()

  // No relay, so the box hands over the link, once, with who it is for. This is what a
  // self-hoster in a photographer's office sees, and the link is what they paste into
  // whatever they already use to talk to their client.
  await expect(host.getByText(fr.admin.inviteLinkCreated(moderator))).toBeVisible()
  const link = await host.getByLabel(fr.admin.inviteLinkUrl).inputValue()
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/)

  // The invitation is not a membership: nothing is on the list until it is accepted.
  const row = host.getByRole('listitem').filter({ hasText: moderator })
  await expect(row).toHaveCount(0)

  // ---- the moderator, on their own machine, opens it -------------------------------

  const theirContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    baseURL: app.baseUrl,
    // Stated, not inherited: a manual `newContext()` does not get `use.locale` (suiteLocale.ts).
    locale: SUITE_LOCALE,
  })
  const theirPage = await theirContext.newPage()

  try {
    // An address that is not an account yet: the link is what makes it one.
    const opened = await theirPage.goto(link)

    // The page is served with the headers that keep the token where it was put: nothing is
    // cached or indexed, and no referrer carries it to whatever the page links to.
    expect(opened?.status()).toBe(200)
    expect(opened?.headers()['cache-control']).toBe('no-store')
    expect(opened?.headers()['x-robots-tag']).toBe('noindex, nofollow')
    expect(opened?.headers()['referrer-policy']).toBe('no-referrer')

    await expect(
      theirPage.getByText(fr.auth.invitationToModerate('Camille & Sacha'), { exact: false }),
    ).toBeVisible()
    // The token is in the address bar and nowhere else the page controls.
    expect(await theirPage.title()).not.toContain(tokenOf(link))
    await expect(theirPage.getByText(tokenOf(link))).toHaveCount(0)

    await theirPage.getByLabel(fr.auth.invitationName).fill('Le modérateur')
    await theirPage.getByLabel(fr.auth.password, { exact: true }).fill(CHOSEN_PASSWORD)
    await theirPage
      .getByLabel(fr.auth.invitationConfirmPassword, { exact: true })
      .fill(CHOSEN_PASSWORD)
    await theirPage.getByRole('button', { name: fr.auth.invitationSubmit }).click()

    // On the event, signed in by the acceptance itself with the password they just chose: no
    // rotation gate, because nobody else ever knew it. And they moderate **this** event, only
    // because of the invitation — no membership was written by a fixture.
    // A moderator lands on the queue they were invited to work: the console's on a laptop, the
    // phone's on a phone (decision 2 of the navigation pass).
    await expect(theirPage).toHaveURL(
      new RegExp(`/admin/events/${event.slug}/moderation(/mobile)?$`),
    )
    await expect(
      theirPage.getByRole('heading', {
        name: new RegExp(`^(${fr.moderation.title}|${fr.mobileModeration.title})$`),
      }),
    ).toBeVisible()
    await expect(
      theirPage.getByRole('button', { name: fr.auth.accountMenu, exact: true }),
    ).toBeVisible()

    // On a phone's width the menu's list stays on the screen: it is anchored to the end of the
    // header, and a list as wide as its longest entry used to hang off the left edge at 360 px.
    await theirPage.setViewportSize({ width: 360, height: 740 })
    await theirPage.getByRole('button', { name: fr.auth.accountMenu, exact: true }).click()
    const widest = await theirPage
      .getByRole('button', { name: fr.auth.logoutEverywhere, exact: true })
      .boundingBox()
    expect(widest, 'the menu lists its entries').not.toBeNull()
    expect(widest?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((widest?.x ?? 0) + (widest?.width ?? 0)).toBeLessThanOrEqual(360)
    await theirPage.keyboard.press('Escape')
    await theirPage.setViewportSize({ width: 1280, height: 800 })

    await theirPage.goto(app.url(`/admin/events/${event.slug}/moderation`))
    await expect(theirPage.getByRole('heading', { name: fr.moderation.title })).toBeVisible()
    await expect(theirPage.getByText(fr.moderation.empty)).toBeVisible()
    await expect(theirPage.getByText(fr.moderation.loadFailed)).toHaveCount(0)

    // The link is spent: it opens nothing a second time, for anybody, and says so in one
    // sentence — the same one an unknown link gets.
    await theirPage.goto(link)
    await expect(theirPage.getByRole('heading', { name: fr.auth.deadLinkTitle })).toBeVisible()
    await expect(theirPage.getByText(fr.errors['invitation.notFound'])).toBeVisible()
    await expect(theirPage.getByLabel(fr.auth.invitationName)).toHaveCount(0)
  } finally {
    await theirContext.close()
  }

  // ---- and back on the host's console, the membership the acceptance wrote ---------

  await host.reload()
  await expect(host.getByRole('listitem').filter({ hasText: moderator })).toBeVisible()
})

test('a link that never existed is the same dead end as a spent one', async ({ app, browser }) => {
  // No oracle: a stranger who guesses a token learns nothing the holder of a spent link does
  // not. 43 characters of the right alphabet, which no invitation was ever issued for.
  const context = await browser.newContext({ baseURL: app.baseUrl, locale: SUITE_LOCALE })
  try {
    const page = await context.newPage()

    await page.goto(app.url(`/invite/${'Q'.repeat(43)}`))

    await expect(page.getByRole('heading', { name: fr.auth.deadLinkTitle })).toBeVisible()
    await expect(page.getByText(fr.errors['invitation.notFound'])).toBeVisible()
    // And a path with no token is the application's own 404, not a form.
    await page.goto(app.url('/invite'))
    await expect(page.getByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
  } finally {
    await context.close()
  }
})

test('an address that already has an account is invited exactly like one that has not, and keeps its own password', async ({
  app,
  browser,
  surfaces,
}) => {
  const { host } = surfaces
  const first = await app.seedEvent({ slug: 'premier', name: 'Premier' })
  const second = await app.seedEvent({ slug: 'second', name: 'Second' })
  const moderator = `deja-vu-${app.baseUrl.split(':').at(-1) ?? '0'}@eventslide.test`

  const invite = async (slug: string): Promise<string> => {
    await host.goto(app.url(`/admin/events/${slug}`))
    await host.getByLabel(fr.admin.moderatorEmail).fill(moderator)
    await host.getByRole('button', { name: fr.admin.inviteSubmit }).click()
    await expect(host.getByText(fr.admin.inviteLinkCreated(moderator))).toBeVisible()
    return host.getByLabel(fr.admin.inviteLinkUrl).inputValue()
  }

  const theirContext = await browser.newContext({ baseURL: app.baseUrl })
  const strangerContext = await browser.newContext({ baseURL: app.baseUrl })
  try {
    // The first invitation makes the account, with the password its owner chooses.
    const firstLink = await invite(first.slug)
    const made = await theirContext.request.post(
      app.url(`/api/invitations/${tokenOf(firstLink)}/accept`),
      {
        headers: await csrfHeaders(theirContext.request, app),
        data: { password: CHOSEN_PASSWORD, displayName: 'Déjà vu' },
      },
    )
    expect(made.status()).toBe(200)

    // The second invitation is to an address that now has an account, and the host's screen
    // is the same: a link to pass on. Nothing on it says the address is known.
    const secondLink = await invite(second.slug)
    expect(secondLink).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/)

    // Somebody who holds only the link cannot attach the account, nor make another one at its
    // address: the box tells them to sign in, and spends nothing.
    const stranger = await strangerContext.request.post(
      app.url(`/api/invitations/${tokenOf(secondLink)}/accept`),
      {
        headers: await csrfHeaders(strangerContext.request, app),
        data: { password: 'une-autre-phrase-de-passe-2026', displayName: 'Intrus' },
      },
    )
    expect(stranger.status()).toBe(409)
    expect((await stranger.json()).error.code).toBe('invitation.signInRequired')

    // The account itself, signed in, accepts as itself.
    const attached = await theirContext.request.post(
      app.url(`/api/invitations/${tokenOf(secondLink)}/accept`),
      { headers: await csrfHeaders(theirContext.request, app), data: {} },
    )
    expect(attached.status()).toBe(200)

    // And its password is the one it chose the first time: the invitation changed nothing.
    const signIn = await strangerContext.request.post(app.url('/api/auth/login'), {
      headers: await csrfHeaders(strangerContext.request, app),
      data: { email: moderator, password: CHOSEN_PASSWORD },
    })
    expect(signIn.status()).toBe(200)
  } finally {
    await theirContext.close()
    await strangerContext.close()
  }
})

test('a person who already has an account is sent to sign in, comes back to the same link, and accepts with it', async ({
  app,
  browser,
  surfaces,
}) => {
  const { host } = surfaces
  const first = await app.seedEvent({ slug: 'connu-1', name: 'Premier évènement' })
  const second = await app.seedEvent({ slug: 'connu-2', name: 'Second évènement' })
  const moderator = `connu-${app.baseUrl.split(':').at(-1) ?? '0'}@eventslide.test`

  const invite = async (slug: string): Promise<string> => {
    await host.goto(app.url(`/admin/events/${slug}`))
    await host.getByLabel(fr.admin.moderatorEmail).fill(moderator)
    await host.getByRole('button', { name: fr.admin.inviteSubmit }).click()
    await expect(host.getByText(fr.admin.inviteLinkCreated(moderator))).toBeVisible()
    return host.getByLabel(fr.admin.inviteLinkUrl).inputValue()
  }

  const accountContext = await browser.newContext({ baseURL: app.baseUrl, locale: SUITE_LOCALE })
  const newMachine = await browser.newContext({ baseURL: app.baseUrl, locale: SUITE_LOCALE })
  try {
    // The account exists already, made by an earlier invitation (over the API: this journey is
    // about the second link).
    const firstLink = await invite(first.slug)
    const made = await accountContext.request.post(
      app.url(`/api/invitations/${tokenOf(firstLink)}/accept`),
      {
        headers: await csrfHeaders(accountContext.request, app),
        data: { password: CHOSEN_PASSWORD, displayName: 'Déjà inscrit' },
      },
    )
    expect(made.status()).toBe(200)

    // A second link, opened on a machine with no session: the page cannot know the address has
    // an account, so it offers to make one.
    const secondLink = await invite(second.slug)
    const page = await newMachine.newPage()
    await page.goto(secondLink)
    await page.getByLabel(fr.auth.invitationName).fill('Déjà inscrit')
    await page.getByLabel(fr.auth.password, { exact: true }).fill('une-autre-phrase-de-passe-2026')
    await page
      .getByLabel(fr.auth.invitationConfirmPassword, { exact: true })
      .fill('une-autre-phrase-de-passe-2026')
    await page.getByRole('button', { name: fr.auth.invitationSubmit }).click()

    // And the box says to sign in instead, having created nothing.
    await expect(page.getByRole('alert')).toContainText(fr.errors['invitation.signInRequired'])

    await page.getByRole('link', { name: fr.auth.submit }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.getByLabel(fr.auth.email).fill(moderator)
    await page.getByLabel(fr.auth.password, { exact: true }).fill(CHOSEN_PASSWORD)
    await page.getByRole('button', { name: fr.auth.submit }).click()

    // Back on the very link, signed in, with nothing to choose.
    await expect(page).toHaveURL(secondLink)
    await expect(page.getByText(fr.auth.invitationSignedInAs(moderator))).toBeVisible()
    await expect(page.getByLabel(fr.auth.password, { exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: fr.auth.invitationAcceptAs }).click()

    await expect(page).toHaveURL(new RegExp(`/admin/events/${second.slug}/moderation(/mobile)?$`))
    await expect(
      page.getByRole('heading', {
        name: new RegExp(`^(${fr.moderation.title}|${fr.mobileModeration.title})$`),
      }),
    ).toBeVisible()
  } finally {
    await accountContext.close()
    await newMachine.close()
  }
})
