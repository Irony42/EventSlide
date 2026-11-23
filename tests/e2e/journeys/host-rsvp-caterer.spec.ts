import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * What to tell the caterer (spec 30, lot 2, PR 8), through a real server and a real browser.
 *
 * What no cheaper ring can answer: **do the diets and menus a guest typed on a phone reach the host's
 * "Traiteur" panel, the caterer's file (with its total line, and without a "peut-être" or a word),
 * and a printed list that holds only the people who come, while a guest's own page never shows a
 * diet?** Two guests answer "je viens" (one with menus and a diet), one answers "peut-être" with a
 * diet and a word. The host reads the panel, downloads the caterer's file, and prints the list (the
 * browser's own print is recorded, not opened).
 *
 * Only `chromium-desktop` runs it: the host's laptop is the surface.
 */

const guest = fr.rsvp.guest
const list = fr.rsvp.list

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
})

test('the caterer panel, file and printed list carry what guests said, the maybes and the words excepted', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-traiteur')
  const headers = await csrfHeaders(host.request, app)
  const saved = await host.request.put(app.url(`/api/events/${event.slug}/rsvp-form`), {
    headers,
    data: {
      enabled: true,
      form: { meals: { enabled: true, options: ['Poisson', 'Végé'] }, companionNames: true },
    },
  })
  expect(saved.status()).toBe(200)

  const answer = async (
    name: string,
    button: string,
    options: { readonly diet?: string; readonly menus?: readonly string[]; readonly word?: string },
  ): Promise<void> => {
    const context = await browser.newContext({
      locale: 'fr-FR',
      viewport: { width: 375, height: 800 },
    })
    const phone = await context.newPage()
    try {
      await phone.goto(url)
      await phone.getByRole('button', { name: button }).click()
      await phone.getByLabel(new RegExp(guest.nameLabel)).fill(name)
      const menus = options.menus ?? []
      if (menus.length > 1) {
        await phone
          .getByRole('button', { name: new RegExp(`${guest.more}.*${guest.adults}`) })
          .click()
      }
      for (const [index, menu] of menus.entries()) {
        await phone
          .getByLabel(new RegExp(`^${guest.mealFor('')}`))
          .nth(index)
          .selectOption(menu)
      }
      if (options.diet !== undefined) {
        await phone.getByLabel(new RegExp(guest.dietLabel)).fill(options.diet)
      }
      if (options.word !== undefined) {
        await phone.getByLabel(new RegExp(guest.messageLabel)).fill(options.word)
      }
      await phone.getByRole('button', { name: guest.send }).click()
      await expect(phone.getByRole('button', { name: guest.edit })).toBeVisible()
      // The guest's own page never says a diet back to anyone but them: this is their own recap.
    } finally {
      await context.close()
    }
  }

  await answer('Léa Martin', guest.yes, { menus: ['Poisson', 'Végé'], diet: 'sans gluten' })
  await answer('Hugo Roux', guest.yes, { menus: ['Poisson'] })
  await answer('Tom Maybe', guest.maybe, { diet: 'noix', word: 'secret du maybe' })

  // --- The panel.
  await host.goto(app.url(`/admin/events/${event.slug}/rsvps`))
  const panel = host.getByRole('region', { name: list.catererTitle })
  await expect(panel.getByText('sans gluten')).toBeVisible()
  await expect(
    panel.getByText(list.catererAdults).locator('xpath=following-sibling::dd'),
  ).toHaveText('3')
  await expect(panel.getByText('Poisson').locator('xpath=following-sibling::dd')).toHaveText('2')

  // --- The file for the caterer: those who come, a total, no maybe, no word.
  const download = host.waitForEvent('download')
  await panel.getByRole('link', { name: list.catererExport }).click()
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const csv = Buffer.concat(chunks).toString('utf8').slice(1).split('\r\n')
  expect(csv[0]).toBe('Nom;Adultes;Enfants;Menus;Allergies ou régime')
  expect(csv).toContain('Léa Martin;2;0;Poisson, Végé;sans gluten')
  expect(csv).toContain('Hugo Roux;1;0;Poisson;')
  expect(csv).toContain('Total;3;0;Poisson ×2, Végé;')
  expect(csv.join('\n')).not.toMatch(/Tom|noix|secret/)

  // --- The printed list: recorded, then closed as the browser would.
  await host.evaluate(() => {
    ;(window as unknown as { printed: number }).printed = 0
    window.print = () => {
      ;(window as unknown as { printed: number }).printed += 1
    }
  })
  await panel.getByRole('button', { name: list.catererPrint }).click()
  await expect
    .poll(() => host.evaluate(() => (window as unknown as { printed: number }).printed))
    .toBe(1)
  const sheet = host.locator('[data-rsvp-print]')
  await expect(sheet).toHaveCount(1)
  const printed = await sheet.innerText()
  for (const wanted of ['Léa Martin', 'Hugo Roux', 'sans gluten']) expect(printed).toContain(wanted)
  for (const unwanted of ['Tom', 'noix', 'secret']) expect(printed).not.toContain(unwanted)
  await host.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(sheet).toHaveCount(0)
})
