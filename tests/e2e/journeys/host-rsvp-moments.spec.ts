import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * Several moments (spec 30, lot 4, PR 13), through a real server and a real browser.
 *
 * What no cheaper ring can answer: **does the moment a guest ticks on a phone reach the host's
 * figures, the table's column and the spreadsheet, and is a household asked only the moments it is
 * invited to?** The host asks two moments (a brunch and a dinner) and invites one household to the
 * dinner only. A guest ticks both; the household's page offers the dinner alone. The host reads the
 * figure per moment, the table and the file.
 *
 * Only `chromium-desktop` runs it: the host's laptop is the surface (the guest's form is covered at
 * the component ring and by the guest journeys).
 */

const guest = fr.rsvp.guest
const list = fr.rsvp.list

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
})

test('a guest ticks moments, a household is asked only its own, and the host reads them per moment', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-moments')
  const headers = await csrfHeaders(host.request, app)
  const base = `/api/events/${event.slug}`
  const saved = await host.request.put(app.url(`${base}/rsvp-form`), {
    headers,
    data: {
      enabled: true,
      form: { moments: [{ label: 'Brunch' }, { label: 'Dîner' }], diet: false },
    },
  })
  expect(saved.status()).toBe(200)
  const moments = (await saved.json()).rsvpForm.form.moments as { id: string; label: string }[]
  const dinner = moments.find((moment) => moment.label === 'Dîner')
  expect(dinner).toBeDefined()
  const household = await host.request.post(app.url(`${base}/households`), {
    headers,
    data: { name: 'Famille Roux', places: 3, moments: [dinner?.id] },
  })
  expect(household.status()).toBe(201)
  const link = (await household.json()).household.token as string

  const phone = async <T>(
    fragment: string,
    act: (page: import('@playwright/test').Page) => Promise<T>,
  ): Promise<T> => {
    const context = await browser.newContext({
      locale: 'fr-FR',
      viewport: { width: 375, height: 800 },
    })
    const page = await context.newPage()
    try {
      await page.goto(`${url}${fragment}`)
      return await act(page)
    } finally {
      await context.close()
    }
  }

  // --- A guest of the common link: nothing is ticked, a yes needs a moment, then both are kept.
  await phone('', async (page) => {
    await page.getByRole('button', { name: guest.yes }).click()
    await page.getByLabel(new RegExp(guest.nameLabel)).fill('Léa Martin')
    await expect(page.getByRole('checkbox', { name: 'Brunch' })).not.toBeChecked()
    await page.getByRole('button', { name: guest.send }).click()
    await expect(page.getByRole('alert')).toContainText(fr.errors['rsvp.momentsRequired'])
    await page.getByRole('checkbox', { name: 'Brunch' }).check()
    await page.getByRole('checkbox', { name: 'Dîner' }).check()
    await page.getByRole('button', { name: guest.send }).click()
    await expect(page.getByText(/Moments.*Brunch, Dîner/)).toBeVisible()
  })

  // --- A household invited to the dinner only is asked the dinner only.
  await phone(`#f=${link}`, async (page) => {
    await page.getByRole('button', { name: guest.yes }).click()
    await expect(page.getByRole('checkbox', { name: 'Dîner' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Brunch' })).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'Dîner' }).check()
    await page.getByRole('button', { name: guest.send }).click()
    await expect(page.getByText(/Moments.*Dîner/)).toBeVisible()
  })

  // --- The host: figures per moment, a column per moment, the file.
  await host.goto(app.url(`/admin/events/${event.slug}/rsvps`))
  await expect(
    host.getByRole('listitem').filter({ hasText: /^Brunch\s:\s1 personne$/ }),
  ).toBeVisible()
  await expect(
    host.getByRole('listitem').filter({ hasText: /^Dîner\s:\s2 personnes$/ }),
  ).toBeVisible()
  const table = host.getByRole('table')
  await expect(table.getByRole('columnheader', { name: 'Brunch' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Dîner' })).toBeVisible()

  const download = host.waitForEvent('download')
  await host.getByRole('link', { name: list.export }).click()
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const csv = Buffer.concat(chunks).toString('utf8').slice(1).split('\r\n')
  expect(csv[0]).toContain(';Brunch;Dîner;')
  expect(csv.find((line) => line.startsWith('Léa Martin;'))).toMatch(/;1;1;/)
  expect(csv.find((line) => line.startsWith('Famille Roux;'))).toMatch(/;;1;/)
})
