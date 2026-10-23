import { csrfHeaders, expect, test } from '../fixtures/app'
import { tokenOf } from '../fixtures/clients'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host hands the console to somebody else by **a link**, and that somebody makes their
 * account by opening it (docs/ROADMAP.md §10.3; free plan G2-09, paid plan P3-10).
 *
 * What this replaced is a password read out loud: the host typed a credential, the box created
 * an account with it, and the invitee signed in with it and was forced to change it. That
 * journey is gone, and so is its shape — **no account exists until the link is accepted**, the
 * person chooses their own password in the same step, and nothing about the invitation says
 * whether the address was already on the box.
 *
 * Two browser contexts, because it is two people: the host's laptop and the moderator's own
 * machine, with its own cookie jar. The e2e box has no mail relay, so the invitation comes back
 * as a link the host copies — which is exactly what a self-hoster with no SMTP sees. Accepting
 * it is driven over the API in the second context: the page that does it from a browser is
 * roadmap G2-10, and this journey asserts the part that only real infrastructure can break —
 * an invitation, a bcrypt hash, a session and a membership, end to end.
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
  })
  const theirPage = await theirContext.newPage()

  try {
    // An address that is not an account yet: the link is what makes it one.
    const preview = await theirContext.request.get(app.url(`/api/invitations/${tokenOf(link)}`))
    expect(preview.status()).toBe(200)
    expect(await preview.json()).toMatchObject({
      kind: 'event',
      role: 'moderator',
      targetName: 'Camille & Sacha',
    })

    const accepted = await theirContext.request.post(
      app.url(`/api/invitations/${tokenOf(link)}/accept`),
      {
        headers: await csrfHeaders(theirContext.request, app),
        data: { password: CHOSEN_PASSWORD, displayName: 'Le modérateur' },
      },
    )
    expect(accepted.status()).toBe(200)
    expect(await accepted.json()).toMatchObject({ status: 'accepted', eventSlug: event.slug })

    // Signed in by the acceptance itself, with the password they just chose: no rotation
    // gate, because nobody else ever knew it. And they moderate **this** event, only because
    // of the invitation — no membership was written by a fixture.
    await theirPage.goto(app.url(`/admin/events/${event.slug}/moderation`))
    await expect(theirPage.getByRole('heading', { name: fr.moderation.title })).toBeVisible()
    await expect(theirPage.getByText(fr.moderation.empty)).toBeVisible()
    await expect(theirPage.getByText(fr.moderation.loadFailed)).toHaveCount(0)

    // The link is spent: it opens nothing a second time, for anybody.
    const again = await theirContext.request.get(app.url(`/api/invitations/${tokenOf(link)}`))
    expect(again.status()).toBe(404)
  } finally {
    await theirContext.close()
  }

  // ---- and back on the host's console, the membership the acceptance wrote ---------

  await host.reload()
  await expect(host.getByRole('listitem').filter({ hasText: moderator })).toBeVisible()
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
