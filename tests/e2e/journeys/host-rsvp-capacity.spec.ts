import type { Page } from '@playwright/test'
import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * Limited places and the waiting list (spec 30, lot 4, PR 14), through a real server and a real browser.
 *
 * What no cheaper ring can answer: **when the places are taken, does a guest's phone say "C'est
 * complet", take a yes as a waiting-list entry that the guest can read back, and does the host see
 * the list apart from those who come, promote it, and find the places taken?** The host limits the
 * party to two people; a first guest takes both places; a second finds the page full, joins the
 * waiting list and reads "Vous êtes sur la liste d'attente"; the host reads the tab, promotes the
 * entry, and the figures follow.
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

test('a full party sends a yes to the waiting list, which the host promotes', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-complete')
  const headers = await csrfHeaders(host.request, app)
  const saved = await host.request.put(app.url(`/api/events/${event.slug}/rsvp-form`), {
    headers,
    data: { enabled: true, form: { capacity: 2, diet: false } },
  })
  expect(saved.status()).toBe(200)

  const phone = async <T>(act: (page: Page) => Promise<T>): Promise<T> => {
    const context = await browser.newContext({
      locale: 'fr-FR',
      viewport: { width: 375, height: 800 },
    })
    const page = await context.newPage()
    try {
      await page.goto(url)
      return await act(page)
    } finally {
      await context.close()
    }
  }

  // --- The first guest takes both places.
  await phone(async (page) => {
    await page.getByRole('button', { name: guest.yes }).click()
    await page.getByLabel(new RegExp(guest.nameLabel)).fill('Léa Martin')
    await page.getByRole('button', { name: new RegExp(`${guest.more}.*${guest.adults}`) }).click()
    await page.getByRole('button', { name: guest.send }).click()
    await expect(page.getByRole('heading', { name: guest.doneYes('Léa') })).toBeVisible()
  })

  // --- The second finds it full, joins the waiting list, and reads it back after a reload.
  await phone(async (page) => {
    await expect(page.getByText(guest.fullTitle)).toBeVisible()
    await expect(page.getByRole('button', { name: guest.yes })).toHaveCount(0)
    await page.getByRole('button', { name: guest.waitlistJoin }).click()
    await page.getByLabel(new RegExp(guest.nameLabel)).fill('Hugo Attente')
    await page.getByRole('button', { name: guest.waitlistJoin }).last().click()
    await expect(page.getByRole('heading', { name: guest.doneWaitlist })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: guest.doneWaitlist })).toBeVisible()
  })

  // --- The host: the list apart, the figures without it, then the promotion.
  await host.goto(app.url(`/admin/events/${event.slug}/rsvps`))
  const tabs = host.getByRole('group', { name: list.tabsLabel })
  await expect(tabs.getByRole('button', { name: new RegExp(`^${list.tabWaitlist}`) })).toBeVisible()
  await expect(host.locator('button[data-kind="yes"]')).toContainText('2')
  await host.getByRole('button', { name: 'Hugo Attente' }).click()
  const detail = host.getByRole('dialog', { name: 'Hugo Attente' })
  await expect(detail.getByRole('button', { name: list.promote })).toBeVisible()
  await detail.getByRole('button', { name: list.promote }).click()
  await expect(detail.getByRole('button', { name: list.promote })).toHaveCount(0)
  await detail.getByRole('button', { name: list.closeDetail }).last().click()
  await expect(tabs.getByRole('button', { name: new RegExp(`^${list.tabWaitlist}`) })).toHaveCount(
    0,
  )
  await expect(host.locator('button[data-kind="yes"]')).toContainText('3')
})
