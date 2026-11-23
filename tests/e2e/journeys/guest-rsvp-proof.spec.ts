import type { Page } from '@playwright/test'
import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * "Qui vient" (spec 30, PR 7), through a real server and real browsers.
 *
 * What no cheaper ring can answer: **does a first name appear on another guest's phone only when its
 * owner ticked the box, and never anything else?** The host shows first names; Léa ticks "Montrer mon
 * prénom", Hugo does not, Inès answers "peut-être" and Tom "non"; a fourth guest opens the link and
 * reads "Léa et 1 autre viennent" (Léa, and Hugo as a count) and nothing of Hugo, Inès or Tom, nor of
 * a diet or a word. When the host switches to the count alone, the names are gone.
 *
 * Only `chromium-desktop` runs it: the guest is a phone-sized context.
 */

const guest = fr.rsvp.guest

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
})

test('a first name is shown to the other guests only when its owner agreed; the host can show a count instead', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-qui-vient')
  const headers = await csrfHeaders(host.request, app)
  const save = async (visibility: string) => {
    const saved = await host.request.put(app.url(`/api/events/${event.slug}/rsvp-form`), {
      headers,
      data: { enabled: true, form: { visibility } },
    })
    expect(saved.status()).toBe(200)
  }
  await save('names')

  const phone = async <T>(run: (page: Page) => Promise<T>): Promise<T> => {
    const context = await browser.newContext({
      locale: 'fr-FR',
      viewport: { width: 375, height: 800 },
    })
    try {
      return await run(await context.newPage())
    } finally {
      await context.close()
    }
  }
  const answer = (name: string, button: string, tick: boolean, diet?: string) =>
    phone(async (page) => {
      await page.goto(url)
      await page.getByRole('button', { name: button }).click()
      await page.getByLabel(new RegExp(guest.nameLabel)).fill(name)
      if (diet !== undefined && button === guest.yes) {
        await page.getByLabel(new RegExp(guest.dietLabel)).fill(diet)
      }
      const box = page.getByRole('checkbox', { name: guest.showNameLabel })
      if (button === guest.yes) {
        await expect(box).not.toBeChecked()
        if (tick) await box.check()
      } else {
        await expect(box).toHaveCount(0)
      }
      await page.getByRole('button', { name: guest.send }).click()
      await expect(page.getByRole('button', { name: guest.edit })).toBeVisible()
    })

  await answer('Léa Martin', guest.yes, true)
  await answer('Hugo Roux', guest.yes, false, 'noix')
  await answer('Inès Lab', guest.maybe, true)
  await answer('Tom Non', guest.no, true)

  await phone(async (page) => {
    await page.goto(url)
    const line = page.getByText(/Léa et 1 autre viennent/)
    await expect(line).toBeVisible()
    const text = (await page.locator('body').innerText()) ?? ''
    for (const hidden of ['Hugo', 'Inès', 'Tom', 'noix']) expect(text).not.toContain(hidden)
  })

  await save('count')
  await phone(async (page) => {
    await page.goto(url)
    await expect(page.getByText('2 personnes ont dit oui')).toBeVisible()
    await expect(page.getByText(/Léa et/)).toHaveCount(0)
  })
})
