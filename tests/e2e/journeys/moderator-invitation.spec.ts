import { expect, test } from '../fixtures/app'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host hands the console to somebody else, and that somebody signs in.
 *
 * This journey exists because of a defect that every other ring missed. The panel sent
 * `{ email }`; the server's `moderatorInvitationBody` is `.strict()` and requires
 * `temporaryPassword` as well, so **every** invitation ever sent from the admin screen
 * came back `400 request.invalid`. A shipped feature that worked in no case at all.
 *
 * Both sides were tested, correctly, and both passed: the ring-4 route test posted a
 * complete body of its own, and the ring-5 panel test asserted that the component calls
 * `api.inviteModerator`. Neither could see the other half. `requestContract.test.ts` now
 * catches that class in milliseconds — but only the *shape*. What it cannot say is that
 * the credential a host reads out actually signs somebody in, because that crosses an
 * invitation, a bcrypt hash, a session, and a forced password rotation. That is what
 * these seconds buy.
 *
 * Two browser contexts, because it is two people: the host's laptop and the moderator's
 * own machine, with its own cookie jar.
 */

/** Long enough for the policy, obviously a fixture, and unique to this spec's worker. */
const TEMPORARY_PASSWORD = 'mot-de-passe-provisoire-du-soir'
const CHOSEN_PASSWORD = 'phrase-que-seul-le-moderateur-connait'

test('a moderator invited by the host signs in with the password read out to them', async ({
  app,
  browser,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'invitation', name: 'Camille & Sacha' })
  // Scoped to the worker: the server outlives this test, and an address that already has
  // an account takes the `created: false` branch and never uses the password below.
  const moderator = `moderateur-${app.baseUrl.split(':').at(-1) ?? '0'}@eventslide.test`

  await host.goto(app.url(`/admin/events/${event.slug}`))

  // ---- the host invites, with the credential they are about to read out ----------

  await host.getByLabel(fr.admin.moderatorEmail).fill(moderator)
  await host.getByLabel(fr.admin.moderatorPassword).fill(TEMPORARY_PASSWORD)
  await host.getByRole('button', { name: fr.admin.inviteSubmit }).click()

  // The confirmation, not merely the absence of an error: before the fix this screen
  // showed `Les informations envoyées ne sont pas valides.` every single time.
  await expect(host.getByText(fr.admin.moderatorInvited(moderator))).toBeVisible()

  // And the membership itself, in the refreshed list — the toast says what the server
  // answered, the row says what it stored. Scoped to the row because the address is on
  // screen twice while the toast is up, and `Modérateur` is a substring of the panel's
  // own heading.
  const row = host.getByRole('listitem').filter({ hasText: moderator })
  await expect(row).toBeVisible()
  await expect(row.getByText(fr.admin.roleModerator, { exact: true })).toBeVisible()

  // ---- the moderator, on their own machine, uses it -------------------------------

  const theirContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    baseURL: app.baseUrl,
  })
  const theirPage = await theirContext.newPage()

  try {
    await theirPage.goto(app.url('/login'))
    await theirPage.getByLabel(fr.auth.email).fill(moderator)
    await theirPage.getByLabel(fr.auth.password).fill(TEMPORARY_PASSWORD)
    await theirPage.getByRole('button', { name: fr.auth.submit }).click()

    // Straight to the rotation gate, and that is the assertion: the temporary password
    // authenticated, and `mustChangePassword` made it single-use. Somebody else chose it
    // and said it out loud, so it cannot be what guards a screen that publishes photos
    // to a room.
    await theirPage.waitForURL(/\/admin\/password$/)
    await expect(theirPage.getByText(fr.auth.changePasswordIntro)).toBeVisible()

    await theirPage.getByLabel(fr.auth.currentPassword).fill(TEMPORARY_PASSWORD)
    await theirPage.getByLabel(fr.auth.newPassword, { exact: true }).fill(CHOSEN_PASSWORD)
    await theirPage.getByLabel(fr.auth.confirmPassword).fill(CHOSEN_PASSWORD)
    await theirPage.getByRole('button', { name: fr.app.save }).click()

    await theirPage.waitForURL(/\/admin$/)

    // And the point of the whole exercise: they can moderate **this** event, and only
    // because of the invitation — no membership was written by a fixture. A caller with
    // a session but no part in the event is answered 404, so the console would show its
    // load failure here rather than its empty queue.
    await theirPage.goto(app.url(`/admin/events/${event.slug}/moderation`))
    await expect(theirPage.getByRole('heading', { name: fr.moderation.title })).toBeVisible()
    await expect(theirPage.getByText(fr.moderation.empty)).toBeVisible()
    await expect(theirPage.getByText(fr.moderation.loadFailed)).toHaveCount(0)
  } finally {
    await theirContext.close()
  }
})

test('an invitation to an address that already has an account keeps its own password', async ({
  app,
  surfaces,
}) => {
  // The other half of the response the panel reads. `created: false` means the account
  // existed, so the password the host just typed was **not** installed — telling them
  // otherwise sends them off to read out a credential that does not work.
  const { host } = surfaces
  const first = await app.seedEvent({ slug: 'premier', name: 'Premier' })
  const second = await app.seedEvent({ slug: 'second', name: 'Second' })
  const moderator = `deja-vu-${app.baseUrl.split(':').at(-1) ?? '0'}@eventslide.test`

  await host.goto(app.url(`/admin/events/${first.slug}`))
  await host.getByLabel(fr.admin.moderatorEmail).fill(moderator)
  await host.getByLabel(fr.admin.moderatorPassword).fill(TEMPORARY_PASSWORD)
  await host.getByRole('button', { name: fr.admin.inviteSubmit }).click()
  await expect(host.getByText(fr.admin.moderatorInvited(moderator))).toBeVisible()

  await host.goto(app.url(`/admin/events/${second.slug}`))
  await host.getByLabel(fr.admin.moderatorEmail).fill(moderator)
  await host.getByLabel(fr.admin.moderatorPassword).fill('un-autre-mot-de-passe-inutile')
  await host.getByRole('button', { name: fr.admin.inviteSubmit }).click()

  await expect(host.getByText(fr.admin.moderatorInvitedExisting(moderator))).toBeVisible()
})
