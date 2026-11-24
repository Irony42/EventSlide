import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The word of those who cannot come (spec 30, lot 4), through a real server and real browsers.
 *
 * What no cheaper ring can answer: **does a guest who answered "no" on their phone leave a word that
 * reaches the host's moderation queue by the guestbook's own door, signed with their first name, and
 * does erasing the reply erase the word?** The guest answers no, is offered « Laisser un mot au livre
 * d'or », writes, is thanked and is not offered a second one; the host's console, already open, sees
 * the message arrive (the guestbook's own signal) and the badge move; the author is in no count of
 * guests; and when the guest deletes the reply the message leaves the queue.
 *
 * Only `chromium-desktop` runs it: the phone is a narrow context of the same engine.
 */

const guest = fr.rsvp.guest
const absent = fr.rsvp.absent

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
})

test('a guest who said no leaves a word, the host moderates it in the guestbook, and erasing the reply erases it', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-mot-absents')
  const headers = await csrfHeaders(host.request, app)
  expect(
    (
      await host.request.put(app.url(`/api/events/${event.slug}/rsvp-form`), {
        headers,
        data: { enabled: true },
      })
    ).status(),
  ).toBe(200)

  // The host's console is already open on the guestbook's queue: nothing waits yet.
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await expect(host.getByRole('tab', { name: fr.moderation.tabMessages })).toBeVisible()

  const context = await browser.newContext({
    locale: 'fr-FR',
    viewport: { width: 390, height: 844 },
  })
  const phone = await context.newPage()
  try {
    // --- A guest who says yes is offered no word.
    await phone.goto(url)
    await phone.getByRole('button', { name: guest.yes }).click()
    await phone.getByLabel(new RegExp(guest.nameLabel)).fill('Léa Martin')
    await phone.getByRole('button', { name: guest.send }).click()
    await expect(phone.getByRole('heading', { name: guest.doneYes('Léa') })).toBeVisible()
    await expect(phone.getByRole('button', { name: absent.offer })).toHaveCount(0)

    // --- Changed to no: the word is offered.
    await phone.getByRole('button', { name: guest.edit }).click()
    await phone.getByRole('button', { name: guest.no }).click()
    await phone.getByRole('button', { name: guest.save }).click()
    await expect(phone.getByRole('heading', { name: guest.doneNo('Léa') })).toBeVisible()
    await phone.getByRole('button', { name: absent.offer }).click()
    await phone.getByLabel(absent.label).fill('Dommage, on pense à vous')
    await phone.getByRole('button', { name: absent.send }).click()
    await expect(phone.getByText(absent.sent)).toBeVisible()
    await expect(phone.getByRole('button', { name: absent.offer })).toHaveCount(0)

    // --- After a reload the page knows a word was left, and offers no second one.
    await phone.reload()
    await expect(phone.getByText(absent.already)).toBeVisible()
    await expect(phone.getByRole('button', { name: absent.offer })).toHaveCount(0)

    // --- The host's open console sees it, by the guestbook's own door, signed with the first name.
    const tab = host.getByRole('tab', {
      name: fr.moderation.tabCounted(fr.moderation.tabMessages, 1),
    })
    await expect(tab).toBeVisible()
    await tab.click()
    await expect(host.getByText('Dommage, on pense à vous')).toBeVisible()
    await expect(host.getByText('Léa', { exact: true }).first()).toBeVisible()

    // --- The author is no guest of the party.
    const stats = await host.request.get(app.url(`/api/events/${event.slug}/stats`))
    expect(((await stats.json()) as { guests: { joined: number } }).guests.joined).toBe(0)
    const guests = await host.request.get(app.url(`/api/events/${event.slug}/guests`))
    expect(((await guests.json()) as { items: unknown[] }).items).toEqual([])

    // --- Erasing the reply erases the word.
    await phone.getByRole('button', { name: guest.delete }).click()
    await phone
      .getByRole('alertdialog', { name: guest.deleteAsk })
      .getByRole('button', { name: guest.deleteYes })
      .click()
    await expect(phone.getByText(guest.deleted)).toBeVisible()
    await host.reload()
    await expect(
      host.getByRole('tab', { name: fr.moderation.tabMessages, exact: true }),
    ).toBeVisible()
    await host.getByRole('tab', { name: fr.moderation.tabMessages }).click()
    await expect(host.getByText('Dommage, on pense à vous')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('the host switches the word off: the guest who said no is no longer offered it', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-sans-mot')
  const headers = await csrfHeaders(host.request, app)
  await host.request.put(app.url(`/api/events/${event.slug}/rsvp-form`), {
    headers,
    data: { enabled: true, form: { absentNote: false } },
  })
  const context = await browser.newContext({ locale: 'fr-FR' })
  const phone = await context.newPage()
  try {
    await phone.goto(url)
    await phone.getByRole('button', { name: guest.no }).click()
    await phone.getByLabel(new RegExp(guest.nameLabel)).fill('Hugo Petit')
    await phone.getByRole('button', { name: guest.send }).click()
    await expect(phone.getByRole('heading', { name: guest.doneNo('Hugo') })).toBeVisible()

    await expect(phone.getByRole('button', { name: absent.offer })).toHaveCount(0)
  } finally {
    await context.close()
  }
})
