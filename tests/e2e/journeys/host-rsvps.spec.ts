import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host's replies page (spec 30, lot 1, PR 5), through a real server and real browsers.
 *
 * What no cheaper ring can answer: **does a guest's reply reach the host's open page by itself, and
 * does the badge of the menu count what the host has not yet seen and stop counting once they look?**
 * A guest answers on a phone while the host's page is open: the row shows up with no reload and the
 * figures move. A second reply arrives while the host is elsewhere in the event: the menu says
 * "1 nouvelle réponse", and the page, once opened, clears it. The host adds a reply received by
 * phone, downloads the spreadsheet (a BOM, `;`, the names), deletes a reply after being asked, and
 * the page does not push the layout sideways on the narrowest phone.
 *
 * Only `chromium-desktop` runs it: the host's laptop is the surface, the narrow width is checked by
 * resizing it.
 */

const list = fr.rsvp.list
const guest = fr.rsvp.guest
const menu = fr.eventMenu

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
})

test('a guest’s reply shows on the host’s open page, the badge counts what is not seen, the host adds, exports and deletes', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-tableau')
  const headers = await csrfHeaders(host.request, app)
  const asked = await host.request.put(app.url(`/api/events/${event.slug}/rsvp-form`), {
    headers,
    data: { enabled: true },
  })
  expect(asked.status()).toBe(200)

  /** One guest on a phone of their own: a device that already answered shows the answer, not the form. */
  const answer = async (name: string, withKids: boolean): Promise<void> => {
    const context = await browser.newContext({ locale: 'fr-FR' })
    const phone = await context.newPage()
    try {
      await phone.goto(url)
      await phone.getByRole('button', { name: guest.yes }).click()
      await phone.getByLabel(new RegExp(guest.nameLabel)).fill(name)
      if (withKids) {
        await phone
          .getByRole('button', { name: new RegExp(`${guest.more}.*${guest.adults}`) })
          .click()
      }
      await phone.getByRole('button', { name: guest.send }).click()
      await expect(
        phone.getByRole('heading', { name: guest.doneYes(name.split(' ')[0] ?? '') }),
      ).toBeVisible()
    } finally {
      await context.close()
    }
  }

  // --- Nothing yet: the page says so and promises to fill by itself.
  await host.goto(app.url(`/admin/events/${event.slug}/rsvps`))
  await expect(host.getByText(list.emptyBody)).toBeVisible()

  // --- A guest answers: the row appears with no reload, and the figure moves.
  await answer('Léa Martin', true)
  const table = host.getByRole('table')
  await expect(table.getByRole('button', { name: 'Léa Martin' })).toBeVisible()
  await expect(host.getByRole('group', { name: list.tilesLabel })).toContainText('2')

  // --- Elsewhere in the event, a second reply lands: the menu counts it and says what it counts.
  await host.goto(app.url(`/admin/events/${event.slug}`))
  const nav = host.getByRole('navigation', { name: menu.label })
  await expect(nav.getByRole('link', { name: new RegExp(`^${menu.sections.rsvps}`) })).toBeVisible()
  await answer('Paul Petit', false)
  await host.reload()
  await expect(
    nav.getByRole('link', {
      name: new RegExp(`^${menu.sections.rsvps} ?, 1 ${list.menuNew.one}$`),
    }),
  ).toBeVisible()

  // --- Opening the page is seeing it: the badge is gone.
  await nav.getByRole('link', { name: new RegExp(`^${menu.sections.rsvps}`) }).click()
  await expect(table.getByRole('button', { name: 'Paul Petit' })).toBeVisible()
  await expect(nav.getByRole('link', { name: menu.sections.rsvps, exact: true })).toBeVisible()

  // --- The host adds a reply received by phone.
  await host.getByRole('button', { name: list.add }).click()
  const form = host.getByRole('dialog', { name: list.formAddTitle })
  await form.getByLabel(new RegExp(`^${list.formName}`)).fill('Ana Lopez')
  await form.getByLabel(list.answerNo).check()
  await form.getByRole('button', { name: list.formSave }).click()
  await expect(table.getByRole('button', { name: 'Ana Lopez' })).toBeVisible()
  await host
    .getByRole('button', { name: new RegExp(`^${list.tabNo}`) })
    .first()
    .click()
  await expect(table.getByRole('button', { name: 'Léa Martin' })).toHaveCount(0)
  await host.getByRole('button', { name: new RegExp(`^${list.tabAll}`) }).click()

  // --- The spreadsheet: a BOM, `;`, the three names.
  const download = host.waitForEvent('download')
  await host.getByRole('link', { name: list.export }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.csv$/)
  const stream = await file.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const csv = Buffer.concat(chunks).toString('utf8')
  expect(csv.charCodeAt(0)).toBe(0xfeff)
  expect(csv).toContain(';')
  for (const name of ['Léa Martin', 'Paul Petit', 'Ana Lopez']) expect(csv).toContain(name)

  // --- On the narrowest phone the page does not push the layout sideways.
  const wide = host.viewportSize()
  await host.setViewportSize({ width: 320, height: 800 })
  await expect(table.getByRole('button', { name: 'Ana Lopez' })).toBeVisible()
  // The cards keep the table's semantics for a screen reader: a header row and one row per reply.
  await expect(table.getByRole('row')).toHaveCount(4)
  await expect(table.getByRole('rowheader')).toHaveCount(3)
  expect(
    await host.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)
  if (wide !== null) await host.setViewportSize(wide)

  // --- Deleting asks first, and the reply is gone from the list.
  await table.getByRole('button', { name: 'Ana Lopez' }).click()
  await host.getByRole('dialog').getByRole('button', { name: list.remove }).click()
  const confirm = host.getByRole('dialog', { name: list.deleteTitle('Ana Lopez') })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: list.deleteYes }).click()
  await expect(table.getByRole('button', { name: 'Ana Lopez' })).toHaveCount(0)
  await expect(table.getByRole('button', { name: 'Léa Martin' })).toBeVisible()
})
