import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { fr } from '../../../web/src/lib/i18n/fr'
import type { Page } from '@playwright/test'
import type { TestApp } from '../fixtures/startTestApp'

/**
 * A household's personal link, on the guest's phone (spec 30, lot 3, PR 11), through a real server.
 *
 * What no cheaper ring can answer: **does `#f=<token>` open the household's own form, leave the
 * address bar clean, and does the household stay ONE reply across two devices?** The host lists a
 * household of four places; a phone opens its link and sees « Bonjour Famille Martin · 4 places
 * prévues pour vous », the name filled in and a counter capped at the places; it answers; a second
 * device opening the same link reads that answer and **changes** it (the host still sees one reply,
 * filed under the household); the reply is erased with the link. On a wrong link the page falls back
 * to the common form and says so. `chromium-desktop` runs the whole journey, `webkit-mobile` the
 * short one (the link, the answer, a reload that finds it again).
 */

const text = fr.rsvp.guest
const plain = (sentence: string): string => sentence.replaceAll(String.fromCodePoint(0x00a0), ' ')

const household = async (
  host: Page,
  app: TestApp,
  slug: string,
  input: { readonly name: string; readonly places: number },
): Promise<{ readonly id: string; readonly token: string }> => {
  const response = await host.request.post(app.url(`/api/events/${slug}/households`), {
    headers: await csrfHeaders(host.request, app),
    data: input,
  })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { household: { id: string; token: string } }).household
}

const enableReplies = async (host: Page, app: TestApp, slug: string): Promise<void> => {
  const asked = await host.request.put(app.url(`/api/events/${slug}/rsvp-form`), {
    headers: await csrfHeaders(host.request, app),
    data: { enabled: true },
  })
  expect(asked.status()).toBe(200)
}

interface HostReply {
  readonly name: string
  readonly answer: string
  readonly adults: number
  readonly kids: number
  readonly source: string
  readonly householdId: string | null
}

const hostReplies = async (host: Page, app: TestApp, slug: string): Promise<HostReply[]> => {
  const response = await host.request.get(app.url(`/api/events/${slug}/rsvps`))
  return ((await response.json()) as { rsvps: HostReply[] }).rsvps
}

test('a household opens its link, answers once for everyone, and changes that one reply from another device', async ({
  app,
  surfaces,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-foyer')
  await enableReplies(host, app, event.slug)
  const martin = await household(host, app, event.slug, { name: 'Famille Martin', places: 4 })
  const inviteToken = url.split('/i/')[1] ?? ''

  const first = await browser.newContext({ locale: 'fr-FR' })
  const phone = await first.newPage()
  const second = await browser.newContext({ locale: 'fr-FR' })
  const laptop = await second.newPage()
  try {
    // --- The link opens the household's form, and leaves the address bar clean.
    await phone.goto(`${url}#f=${martin.token}`)
    await expect(phone.getByText(plain(text.householdGreeting('Famille Martin')))).toBeVisible()
    await expect(phone.getByText(text.householdPlaces(4))).toBeVisible()
    expect(new URL(phone.url()).hash).toBe('')
    expect(
      await phone.evaluate(
        (key) => window.localStorage.getItem(key),
        `eventslide.rsvp.household.${inviteToken}`,
      ),
    ).toContain(martin.token)

    await phone.getByRole('button', { name: text.yes }).click()
    await expect(phone.getByLabel(new RegExp(text.nameLabel))).toHaveValue('Famille Martin')
    const more = phone.getByRole('button', { name: new RegExp(`${text.more}.*${text.adults}`) })
    for (let i = 0; i < 6; i += 1) await more.click()
    await expect(phone.getByLabel(text.adults, { exact: true })).toHaveText('4')
    await phone.getByRole('button', { name: new RegExp(`${text.less}.*${text.adults}`) }).click()
    await phone.getByRole('button', { name: new RegExp(`${text.more}.*${text.kids}`) }).click()
    await phone.getByRole('button', { name: text.send }).click()
    await expect(phone.getByRole('heading', { name: text.doneYes('Famille') })).toBeVisible()

    // --- The host sees one reply, from the household's link, filed under it, with no token in it.
    let replies = await hostReplies(host, app, event.slug)
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({
      name: 'Famille Martin',
      answer: 'yes',
      adults: 3,
      kids: 1,
      source: 'household',
      householdId: martin.id,
    })

    // --- A reload finds it again, from the device's memory, with no fragment.
    await phone.reload()
    await expect(phone.getByRole('heading', { name: text.doneYes('Famille') })).toBeVisible()

    // --- Another device opens the same link: it reads that answer and changes it, never adds one.
    await laptop.goto(`${url}#f=${martin.token}`)
    await expect(laptop.getByRole('heading', { name: text.doneYes('Famille') })).toBeVisible()
    await laptop.getByRole('button', { name: text.edit }).click()
    await laptop.getByRole('button', { name: text.no }).click()
    await laptop.getByRole('button', { name: text.save }).click()
    await expect(laptop.getByRole('heading', { name: text.doneNo('Famille') })).toBeVisible()
    replies = await hostReplies(host, app, event.slug)
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ answer: 'no', source: 'household', householdId: martin.id })

    // --- Erasing it with the link frees the household to answer afresh.
    await phone.reload()
    await expect(phone.getByRole('heading', { name: text.doneNo('Famille') })).toBeVisible()
    await phone.getByRole('button', { name: text.delete }).click()
    await phone.getByRole('button', { name: text.deleteYes }).click()
    await expect(phone.getByText(text.deleted)).toBeVisible()
    expect(await hostReplies(host, app, event.slug)).toHaveLength(0)
  } finally {
    await first.close()
    await second.close()
  }
})

test('a household link that opens nothing falls back to the common form and says so', async ({
  app,
  surfaces,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-foyer-perime')
  await enableReplies(host, app, event.slug)
  const martin = await household(host, app, event.slug, { name: 'Famille Martin', places: 4 })
  // The host changes the link: the one a household kept (or was sent) stops at once.
  const rotated = await host.request.post(
    app.url(`/api/events/${event.slug}/households/${martin.id}/rotate`),
    { headers: await csrfHeaders(host.request, app), data: {} },
  )
  expect(rotated.status()).toBe(200)

  const context = await browser.newContext({ locale: 'fr-FR' })
  const phone = await context.newPage()
  try {
    await phone.goto(`${url}#f=${martin.token}`)

    await expect(phone.getByText(plain(text.householdGone))).toBeVisible()
    await expect(phone.getByRole('button', { name: text.yes })).toBeVisible()
    expect(new URL(phone.url()).hash).toBe('')
    expect(
      await phone.evaluate(
        (key) => window.localStorage.getItem(key),
        `eventslide.rsvp.household.${url.split('/i/')[1] ?? ''}`,
      ),
    ).toBeNull()
  } finally {
    await context.close()
  }
})

test('on a phone a household opens its link, answers, and finds the answer again after a reload', async ({
  app,
  surfaces,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit-mobile', 'the phone engine run')
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-foyer-mobile')
  await enableReplies(host, app, event.slug)
  const durand = await household(host, app, event.slug, { name: 'Les Durand', places: 3 })

  const context = await browser.newContext({ locale: 'fr-FR' })
  const guest = await context.newPage()
  try {
    await guest.goto(`${url}#f=${durand.token}`)
    await expect(guest.getByText(plain(text.householdGreeting('Les Durand')))).toBeVisible()
    expect(new URL(guest.url()).hash).toBe('')
    await guest.getByRole('button', { name: text.no }).click()
    await guest.getByRole('button', { name: text.send }).click()
    await expect(guest.getByRole('heading', { name: text.doneNo('Les') })).toBeVisible()

    await guest.reload()
    await expect(guest.getByRole('heading', { name: text.doneNo('Les') })).toBeVisible()
    await expect(guest.getByRole('button', { name: text.edit })).toBeVisible()

    const replies = await hostReplies(host, app, event.slug)
    expect(replies).toMatchObject([
      { name: 'Les Durand', answer: 'no', source: 'household', householdId: durand.id },
    ])
  } finally {
    await context.close()
  }
})
