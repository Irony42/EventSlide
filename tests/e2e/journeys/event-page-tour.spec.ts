import type { Locator, Page } from '@playwright/test'
import { csrfHeaders, expect, test } from '../fixtures/app'
import type { TestApp } from '../fixtures/startTestApp'
import { aPlainAccount, createEvent, INVITED_ACCOUNT_PASSWORD } from '../fixtures/clients'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The first visit to an event's page opens a short guided tour, once per **account**.
 *
 * Ring 6 for two things no cheaper ring sees. The geometry: the bubble and every one of its
 * buttons stay on the screen and inside the bubble at every step, on the laptop and on the phone
 * (the first mock-up had a "Suivant" sticking out of it). And the memory: the tour is left on one
 * device and is not offered again on another, because what was seen lives on the server
 * (`POST /api/auth/tours/:tour`, `toursSeen` on `GET /api/auth/me`), not in a browser.
 *
 * The bootstrap owner has seen it (`startTestApp.ts`), so the account here is a new one, invited
 * the way the product makes accounts, and the owner of a draft event it created itself.
 */

const signIn = async (page: Page, app: TestApp, email: string): Promise<void> => {
  const response = await page.request.post(app.url('/api/auth/login'), {
    headers: await csrfHeaders(page.request, app),
    data: { email, password: INVITED_ACCOUNT_PASSWORD },
  })
  expect(response.ok(), `the account signs in: ${response.status()}`).toBe(true)
}

/**
 * The bubble is on the screen, and every button is inside it — once the step has settled: a step
 * scrolls its region into view, and the light and the bubble follow on the next frame.
 */
const expectContained = async (page: Page, bubble: Locator): Promise<void> => {
  await expect(async () => {
    await contained(page, bubble)
  }).toPass({ timeout: 5_000 })
}

const contained = async (page: Page, bubble: Locator): Promise<void> => {
  const viewport = page.viewportSize()
  const box = await bubble.boundingBox()
  if (viewport === null || box === null) throw new Error('the tour was never laid out')
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)

  for (const button of await bubble.getByRole('button').all()) {
    const inner = await button.boundingBox()
    if (inner === null) throw new Error('a button of the tour was never laid out')
    expect(inner.x).toBeGreaterThanOrEqual(box.x)
    expect(inner.y).toBeGreaterThanOrEqual(box.y)
    expect(inner.x + inner.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
    expect(inner.y + inner.height).toBeLessThanOrEqual(box.y + box.height + 0.5)
  }
}

test('a host is shown the event page once, on their first visit, and not again on another device', async ({
  app,
  page,
  browser,
}) => {
  const account = await aPlainAccount(app)
  const { slug } = await createEvent(account)
  // Each step scrolls at once rather than smoothly, so what is measured is where it lands.
  await page.emulateMedia({ reducedMotion: 'reduce' })

  await signIn(page, app, account.email)
  await page.goto(app.url(`/admin/events/${slug}`))

  const tour = page.getByRole('dialog')
  await expect(tour).toHaveAccessibleName(fr.admin.tourWelcomeTitle)
  await expectContained(page, tour)

  // Nothing on the page can be pressed from under the tour: a click aimed at "Ouvrir aux
  // invités" lands on the tour's layer, so no confirmation opens and the event stays a draft.
  const goLive = await page.locator('[data-tour="lifecycle"] button').first().boundingBox()
  if (goLive === null) throw new Error('the lifecycle button was never laid out')
  await page.mouse.click(goLive.x + goLive.width / 2, goLive.y + goLive.height / 2)
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(tour).toHaveAccessibleName(fr.admin.tourWelcomeTitle)
  const event = await account.api.get(`/api/events/${slug}`)
  expect(event.body['status']).toBe('draft')

  // Through every stop of a draft owner's tour, each laid out where it fits.
  const stops = [
    fr.admin.tourNowTitle,
    fr.admin.tourAccessTitle,
    fr.admin.tourOpenTitle,
    fr.admin.tourEveningTitle,
    fr.admin.tourOverviewTitle,
    fr.admin.tourEndTitle,
  ]
  await tour.getByRole('button', { name: fr.ui.tourStart }).click()
  for (const [index, title] of stops.entries()) {
    await expect(tour).toHaveAccessibleName(title)
    await expectContained(page, tour)
    if (index < stops.length - 1) {
      await tour.getByRole('button', { name: fr.ui.tourNext }).click()
    } else {
      // Finished, and told to the server before anything reloads: the write is what the rest of
      // this journey is about.
      await Promise.all([
        page.waitForResponse((response) => response.url().endsWith('/api/auth/tours/eventPage')),
        tour.getByRole('button', { name: fr.ui.tourFinish }).click(),
      ])
    }
  }
  await expect(tour).toHaveCount(0)
  // Focus is on the button that brings it back.
  await expect(page.getByRole('button', { name: fr.admin.tourButton })).toBeFocused()

  // The same page again: not offered by itself.
  await page.reload()
  await expect(page.getByRole('button', { name: fr.admin.tourButton })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Another device, the same account: not offered either.
  const other = await browser.newContext({ baseURL: app.baseUrl, locale: SUITE_LOCALE })
  try {
    const phone = await other.newPage()
    await signIn(phone, app, account.email)
    await phone.goto(app.url(`/admin/events/${slug}`))
    const replay = phone.getByRole('button', { name: fr.admin.tourButton })
    await expect(replay).toBeVisible()
    await expect(phone.getByRole('dialog')).toHaveCount(0)

    // The button replays it whenever, and nothing on the page can be pressed from under it.
    await replay.click()
    await expect(phone.getByRole('dialog')).toHaveAccessibleName(fr.admin.tourWelcomeTitle)
    await phone.keyboard.press('Escape')
    await expect(phone.getByRole('dialog')).toHaveCount(0)
  } finally {
    await other.close()
  }
})
