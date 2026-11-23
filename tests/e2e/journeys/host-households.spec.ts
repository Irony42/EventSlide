import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host's guest list (spec 30, lot 3, PR 10), through a real server and a real browser.
 *
 * What no cheaper ring can answer: **does a pasted list become households with links of their own,
 * does the guided reminder prepare a message with the right link and no recipient, and does filing a
 * reply under a household move the "sans réponse" figure on the replies page?** The host pastes
 * three lines (one unreadable: the dialog says which and why), sees two households, reads the
 * reminder of the first, files a reply received by phone under it from the replies page, watches the
 * tile count one household fewer, and deletes the other after being asked. On the narrowest phone
 * the page does not push the layout sideways.
 *
 * Only `chromium-desktop` runs it.
 */

const list = fr.rsvp.list
const text = fr.rsvp.households
const plain = (sentence: string): string => sentence.replaceAll(String.fromCodePoint(0x00a0), ' ')

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
})

test('the host pastes a guest list, reminds a household, files a reply under it and deletes another', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-foyers')
  const headers = await csrfHeaders(host.request, app)
  const asked = await host.request.put(app.url(`/api/events/${event.slug}/rsvp-form`), {
    headers,
    data: { enabled: true, deadline: '2027-12-01' },
  })
  expect(asked.status()).toBe(200)

  // --- Pasting a list: two households stored, the unreadable line named with its reason.
  await host.goto(app.url(`/admin/events/${event.slug}/rsvps/guests`))
  await expect(host.getByText(text.emptyTitle)).toBeVisible()
  await host.getByRole('button', { name: text.importList }).click()
  const paste = host.getByRole('dialog', { name: text.importTitle })
  await paste
    .getByLabel(text.importLabel)
    .fill('Famille Martin ; 4\nLéa Durand ; 2\nDupont ; beaucoup')
  await paste.getByRole('button', { name: text.importSubmit }).click()
  await expect(paste.getByText(text.importDone(2))).toBeVisible()
  await expect(
    paste.getByText(plain(text.importSkippedLine(3, text.importReasons.places))),
  ).toBeVisible()
  await paste.getByRole('button', { name: text.importClose, exact: true }).click()

  const table = host.getByRole('table')
  await expect(table.getByRole('row', { name: /Famille Martin/ })).toBeVisible()
  await expect(table.getByRole('row', { name: /Léa Durand/ })).toBeVisible()
  await expect(host.getByText(text.summary(2, 6))).toBeVisible()

  // --- The reminder of the first household: its own link in the fragment, no recipient anywhere.
  const panel = host.getByRole('region', { name: text.reminderTitle })
  await expect(panel.getByText(text.reminderProgress(1, 2))).toBeVisible()
  const message = await panel.getByRole('textbox').inputValue()
  const households = (await (
    await host.request.get(app.url(`/api/events/${event.slug}/households`))
  ).json()) as { households: { id: string; name: string; token: string }[] }
  const martin = households.households.find((household) => household.name === 'Famille Martin')
  expect(message).toContain('Bonjour Famille Martin')
  expect(message.endsWith(`${url}#f=${martin?.token ?? ''}`)).toBe(true)
  const whatsapp = await panel
    .getByRole('link', { name: text.reminderWhatsapp })
    .getAttribute('href')
  expect(whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(message)}`)

  // --- A reply received by phone, filed under the household from the replies page.
  const added = await host.request.post(app.url(`/api/events/${event.slug}/rsvps`), {
    headers,
    data: { name: 'Pierre Martin', answer: 'yes', adults: 2, kids: 1 },
  })
  expect(added.status()).toBe(201)
  await host.goto(app.url(`/admin/events/${event.slug}/rsvps`))
  const tile = host.getByRole('link', { name: new RegExp(list.tileNoReply) })
  await expect(tile).toContainText('2')
  await host.getByRole('button', { name: 'Pierre Martin' }).click()
  const detail = host.getByRole('dialog')
  await detail
    .getByRole('combobox', { name: list.detailHousehold })
    .selectOption({ label: 'Famille Martin' })
  await detail.getByRole('button', { name: list.detailHouseholdFile }).click()
  await expect(detail.getByText('Famille Martin')).toBeVisible()
  await detail.getByRole('button', { name: list.closeDetail, exact: true }).click()
  await expect(tile).toContainText('1')

  // --- Back on the list: Martin has answered, only Durand is waited for.
  await host.getByRole('link', { name: list.guests }).first().click()
  await expect(table.getByRole('row', { name: /Famille Martin/ })).toContainText(text.statusYes(3))
  await expect(
    host.getByRole('region', { name: text.reminderTitle }).getByText('Léa Durand', { exact: true }),
  ).toBeVisible()

  // --- On the narrowest phone the page does not push the layout sideways.
  const wide = host.viewportSize()
  await host.setViewportSize({ width: 320, height: 800 })
  await expect(table.getByRole('row', { name: /Léa Durand/ })).toBeVisible()
  expect(
    await host.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)
  if (wide !== null) await host.setViewportSize(wide)

  // --- Deleting asks first, and the household is gone from the list.
  await host.getByRole('button', { name: `${text.remove} · Léa Durand` }).click()
  const confirm = host.getByRole('dialog', { name: text.deleteTitle('Léa Durand') })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: text.deleteYes }).click()
  await expect(table.getByRole('row', { name: /Léa Durand/ })).toHaveCount(0)
})
