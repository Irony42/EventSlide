import type { Locator, Page } from '@playwright/test'
import { aGuestOf, aName, bytesOfFile, uploadPhoto } from '../fixtures/clients'
import { expect, projectorContextOptions, test, wallUrl } from '../fixtures/app'
import { aPhoto } from '../fixtures/media'
import { sessionOn, succeeded, type Session } from '../fixtures/session'
import type { TestApp } from '../fixtures/startTestApp'
import { OWNER_SETTLED_PASSWORD } from '../fixtures/startTestApp'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host's console for announcements, on the event page, with two projected walls (spec 21, PR 4).
 *
 * What only a real browser on a real server can say: that what a host types on a laptop becomes,
 * by the server's clock alone, a band and then a card on **two** screens in the same second; that
 * "Lancer maintenant" puts a card up at once; and that the form holds on a 375 px phone, which is
 * where it is used standing in the room: no sideways scroll, controls a thumb can hit, the launch
 * button reachable without going down the page, and a form that does not jump when a time is typed.
 *
 * The time is a **minute** (`<input type="time">`), so the host cannot ask for "in 40 seconds":
 * the journey types the next whole minute that is at least fifteen seconds away, with the
 * shortest countdown the form offers (1 min). That minute is fifteen to seventy-five seconds
 * away, so the countdown, and with it the band, starts at most fifteen seconds after scheduling,
 * and the card follows at the minute. The rules of resolving a time of day (midnight,
 * a scheduled opening, the twelve-hour warning) are one ring down. No `waitForTimeout`.
 */

const CARD = '[data-wall-announcement-card]'
const BAND = '[data-wall-announcement-band]'
const copy = fr.announcement

/** The owner the server bootstrapped, over `fetch`. */
const hostOf = async (app: TestApp): Promise<Session> => {
  const host = await sessionOn(app.baseUrl)
  const login = await host.post('/api/auth/login', {
    email: app.owner.email,
    password: OWNER_SETTLED_PASSWORD,
  })
  if (!succeeded(login)) throw new Error(`host login failed with ${login.status}`)
  return host
}

/** An open event with three published photographs: the slide clock needs more than one. */
const arrange = async (app: TestApp, label: string) => {
  const slug = aName(label).toLowerCase().replace(/\s+/g, '-')
  const event = await app.seedEvent({ slug, name: 'Camille & Sacha' })
  const host = await hostOf(app)
  const guest = await aGuestOf(app, event.joinCode)
  expect(succeeded(await host.patch(`/api/events/${slug}/settings`, { moderation: 'auto' }))).toBe(
    true,
  )
  for (let index = 0; index < 3; index += 1) {
    const sent = await uploadPhoto(
      guest,
      slug,
      await bytesOfFile(await aPhoto(`console-${slug}-${index}`, 1200, 900)),
    )
    expect(sent.status).toBe(201)
  }
  return { slug }
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** The next whole minute at least `seconds` away, as the form's `HH:mm`: the browser shares this machine's zone. */
const nextMinute = (seconds: number): string => {
  const at = new Date(Math.ceil((Date.now() + seconds * 1000) / 60_000) * 60_000)
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`
}

const field = (page: Page, label: string): Locator => page.getByLabel(label)
const time = (page: Page): Locator => page.getByLabel(new RegExp(`^${copy.time}`, 'u'))
const chip = (page: Page, legend: string, name: string): Locator =>
  page.getByRole('group', { name: legend }).getByRole('radio', { name })

const box = async (locator: Locator, what: string) => {
  const found = await locator.boundingBox()
  if (found === null) throw new Error(`${what} has no box to measure`)
  return found
}

test.describe('the announcements console', () => {
  test('a time typed on the host’s page puts the band, then the card, on two walls in the same second', async ({
    app,
    surfaces,
    browser,
  }) => {
    test.setTimeout(150_000)
    const { slug } = await arrange(app, 'console-heure')
    const { host, projector } = surfaces
    const second = await browser.newContext(projectorContextOptions(app))
    const other = await second.newPage()
    try {
      const url = wallUrl(app, slug)
      await projector.goto(url)
      await other.goto(url)
      await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
      await expect(other.getByTestId('wall-slide').first()).toBeVisible()

      await host.goto(app.url(`/admin/events/${slug}/announcements`))
      await field(host, copy.text).fill('Le gâteau arrive')
      await chip(host, copy.countdown, '1 min').check()
      await chip(host, copy.duration, '15 s').check()
      await time(host).fill(nextMinute(15))
      // The line says which moment that is, in words, before anything is saved.
      await expect(host.getByText(/, dans /u)).toBeVisible()
      await host.getByRole('button', { name: copy.schedule }).click()

      // It is in the list at once, and not on the wall as a card yet. Its countdown starts within
      // fifteen seconds: the minute typed can be up to seventy-five seconds away, the countdown one.
      const row = host.getByRole('group', { name: 'Le gâteau arrive' })
      await expect(row.getByText(copy.states.counting)).toBeVisible({ timeout: 20_000 })
      await expect(projector.locator(CARD)).toHaveCount(0)
      await expect(projector.locator(BAND)).toContainText('Le gâteau arrive', { timeout: 20_000 })
      await expect(other.locator(BAND)).toContainText('Le gâteau arrive', { timeout: 20_000 })
      await expect(projector.locator(BAND)).toContainText(/dans \d:\d\d/u)

      const seenAt = async (page: Page): Promise<number> => {
        await expect(page.locator(CARD)).toBeVisible({ timeout: 90_000 })
        return Date.now()
      }
      const [first, last] = await Promise.all([seenAt(projector), seenAt(other)])
      expect(Math.abs(first - last)).toBeLessThan(2_000)
      await expect(projector.locator(CARD)).toContainText('Le gâteau arrive')
      await expect(row.getByText(copy.states.showing)).toBeVisible()

      // The card is a layer: the photographs go on rotating under it.
      const photo = () => projector.getByTestId('wall-slide').first().getAttribute('data-photo-id')
      const before = await photo()
      await expect.poll(photo, { timeout: 8_000 }).not.toBe(before)

      // Its fifteen seconds are up on both screens, and the list says it is past.
      await expect(projector.locator(CARD)).toHaveCount(0, { timeout: 30_000 })
      await expect(other.locator(CARD)).toHaveCount(0, { timeout: 5_000 })
      await expect(row.getByText(copy.states.over)).toBeVisible()
      await expect(row.getByRole('button', { name: copy.relaunch })).toBeVisible()
    } finally {
      await second.close()
    }
  })

  test('"Lancer maintenant" puts a card on the wall at once, and "Retirer de l’écran" takes it off', async ({
    app,
    surfaces,
  }) => {
    const { slug } = await arrange(app, 'console-maintenant')
    const { host, projector } = surfaces
    await projector.goto(wallUrl(app, slug))
    await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
    await expect(projector.locator(CARD)).toHaveCount(0)

    await host.goto(app.url(`/admin/events/${slug}/announcements`))
    await field(host, copy.text).fill('Navettes à minuit')
    // No time asked for: the launch is the moment it is pressed.
    await host.getByRole('button', { name: copy.launchNow }).click()

    await expect(projector.locator(CARD)).toContainText('Navettes à minuit', { timeout: 10_000 })
    const row = host.getByRole('group', { name: 'Navettes à minuit' })
    await expect(row.getByText(copy.states.showing)).toBeVisible()

    await row.getByRole('button', { name: copy.withdraw }).click()
    await expect(projector.locator(CARD)).toHaveCount(0, { timeout: 10_000 })
    await expect(host.getByRole('group', { name: 'Navettes à minuit' })).toHaveCount(0)
  })

  test('a discreet text takes no countdown, and its words stay correctable on screen', async ({
    app,
    surfaces,
  }) => {
    const { slug } = await arrange(app, 'console-discrete')
    const { host, projector } = surfaces
    await projector.goto(wallUrl(app, slug))
    await expect(projector.getByTestId('wall-slide').first()).toBeVisible()

    await host.goto(app.url(`/admin/events/${slug}/announcements`))
    await host.getByRole('radio', { name: new RegExp(copy.kindDiscreet, 'u') }).check()
    await expect(host.getByRole('group', { name: copy.countdown })).toHaveCount(0)
    await expect(chip(host, copy.duration, '15 min')).toBeChecked()
    await field(host, copy.text).fill('Le buffet est ouver')
    await host.getByRole('button', { name: copy.launchNow }).click()

    const pill = projector.locator('[data-wall-announcement-pill]')
    await expect(pill).toContainText('Le buffet est ouver', { timeout: 10_000 })
    const row = host.getByRole('group', { name: 'Le buffet est ouver' })
    await row.getByRole('button', { name: copy.edit }).click()
    await expect(time(host)).toBeDisabled()
    await field(host, copy.text).fill('Le buffet est ouvert')
    await host.getByRole('button', { name: copy.save }).click()

    // The words change on the wall in place, and the one announcement is still the one on screen.
    await expect(pill).toContainText('Le buffet est ouvert', { timeout: 10_000 })
    await expect(projector.locator(CARD)).toHaveCount(0)
  })

  test('holds on a 375 px phone: one column, no sideways scroll, targets of 44 px, the launch under the thumb', async ({
    app,
    surfaces,
  }) => {
    const { slug } = await arrange(app, 'console-mobile')
    const { host } = surfaces
    await host.setViewportSize({ width: 375, height: 812 })
    await host.goto(app.url(`/admin/events/${slug}/announcements`))

    const heading = host.getByRole('heading', { name: copy.title })
    await heading.scrollIntoViewIfNeeded()
    const text = field(host, copy.text)
    await expect(text).toBeVisible()
    await text.fill('Le gâteau arrive')

    // No sideways scroll on the page, and no control wider than the screen.
    const overflow = await host.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    // The launch button is on screen without going down the page, however the form is scrolled.
    const launch = host.getByRole('button', { name: copy.launchNow })
    await expect(launch).toBeVisible()
    const launchBox = await box(launch, 'the launch button')
    expect(launchBox.y + launchBox.height).toBeLessThanOrEqual(812)
    expect(launchBox.width).toBeGreaterThan(375 / 2)

    // Thumb targets: every control of the form is at least 44 px tall.
    const form = host.locator('form').filter({ has: text })
    const controls = form.locator(
      'button, input[type="text"], input[type="time"], label:has(input[type="radio"])',
    )
    const heights = await controls.evaluateAll((elements) =>
      elements
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => Math.round(rect.height)),
    )
    expect(heights.length).toBeGreaterThan(8)
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44)

    // A time typed does not move the form: the line that resolves it had its room reserved.
    const before = await box(form, 'the form')
    await time(host).fill(nextMinute(15 * 60))
    await expect(host.getByText(/, dans /u)).toBeVisible()
    const after = await box(form, 'the form')
    expect(after.height).toBeGreaterThanOrEqual(before.height)
    expect(after.height - before.height).toBeLessThanOrEqual(4)
    expect(
      await host.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
  })
})
