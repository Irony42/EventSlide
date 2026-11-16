import { aGuestOf, aName, bytesOfFile, uploadPhoto } from '../fixtures/clients'
import { expect, projectorContextOptions, test, wallUrl } from '../fixtures/app'
import { aPhoto } from '../fixtures/media'
import { sessionOn, succeeded, type Session } from '../fixtures/session'
import type { TestApp } from '../fixtures/startTestApp'
import { OWNER_SETTLED_PASSWORD } from '../fixtures/startTestApp'

/**
 * Scheduled announcements on the projected wall, fullscreen kind (spec 21).
 *
 * Two things only a real browser on a real server can say. The first is the promise the feature
 * makes to a room: two screens show the same card in the same second, because both derive it from
 * the server's clock. The second is that the card is a layer: the photographs go on rotating under
 * it, which `hold` would have stopped.
 *
 * The host's console for announcements arrives with a later change, so the announcement is armed
 * through the API, exactly as that console will. A countdown is one of 0, 1, 5, 10 or 15 minutes,
 * so the timed card here has none and the band is looked at from the start of a long one, without
 * waiting for its end.
 */

const CARD = '[data-wall-announcement-card]'
const BAND = '[data-wall-announcement-band]'

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
      await bytesOfFile(await aPhoto(`annonce-${slug}-${index}`, 1200, 900)),
    )
    expect(sent.status).toBe(201)
  }
  return { slug, host }
}

const inSeconds = (seconds: number): string => new Date(Date.now() + seconds * 1000).toISOString()

test.describe('the wall and its announcements', () => {
  test('two projectors show the card in the same second, the photographs go on under it, and it goes away', async ({
    app,
    surfaces,
    browser,
  }) => {
    const { slug, host } = await arrange(app, 'gateau')
    const { projector } = surfaces
    const second = await browser.newContext(projectorContextOptions(app))
    const other = await second.newPage()
    try {
      const url = wallUrl(app, slug)
      await projector.goto(url)
      await other.goto(url)
      await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
      await expect(other.getByTestId('wall-slide').first()).toBeVisible()
      await expect(projector.locator(CARD)).toHaveCount(0)

      // Six seconds ahead, ten on screen, no countdown: the host's "Gâteau à 22 h", armed.
      const armed = await host.post(`/api/events/${slug}/announcements`, {
        text: 'Le gâteau arrive',
        at: inSeconds(6),
        durationSeconds: 10,
        countdownSeconds: 0,
      })
      expect(armed.status).toBe(201)

      const seenAt = async (page: typeof projector): Promise<number> => {
        await expect(page.locator(CARD)).toBeVisible({ timeout: 20_000 })
        return Date.now()
      }
      const [first, last] = await Promise.all([seenAt(projector), seenAt(other)])
      expect(Math.abs(first - last)).toBeLessThan(2_000)
      await expect(projector.locator(CARD)).toContainText('Le gâteau arrive')
      await expect(projector.locator(CARD).getByRole('status')).toHaveText(
        'Annonce : Le gâteau arrive.',
      )

      // The card is a layer: the slide clock is not held, so the photograph under it changes.
      const photo = () => projector.getByTestId('wall-slide').first().getAttribute('data-photo-id')
      const before = await photo()
      await expect.poll(photo, { timeout: 5_000 }).not.toBe(before)

      // It is over by its own time, on both screens, and the wall is what it was.
      await expect(projector.locator(CARD)).toHaveCount(0, { timeout: 20_000 })
      await expect(other.locator(CARD)).toHaveCount(0, { timeout: 5_000 })
      await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
    } finally {
      await second.close()
    }
  })

  test('the countdown banner counts down in the top centre, and no card is up yet', async ({
    app,
    surfaces,
  }) => {
    const { slug, host } = await arrange(app, 'bandeau')
    const { projector } = surfaces
    await projector.goto(wallUrl(app, slug))
    await expect(projector.getByTestId('wall-slide').first()).toBeVisible()

    // A one-minute countdown that began three seconds ago: the text has been served for a while.
    const armed = await host.post(`/api/events/${slug}/announcements`, {
      text: 'Le discours',
      at: inSeconds(63),
      durationSeconds: 30,
      countdownSeconds: 60,
    })
    expect(armed.status).toBe(201)

    const band = projector.locator(BAND)
    await expect(band).toBeVisible({ timeout: 20_000 })
    await expect(band).toContainText('Le discours')
    await expect(band).toContainText(/dans \d:\d\d/)
    await expect(projector.locator(CARD)).toHaveCount(0)
    await expect(projector.locator('[data-wall-layout]')).toHaveAttribute('data-wall-chrome', /top/)

    // Geometry, not pixels: top centre of the frame.
    const box = await band.boundingBox()
    const viewport = projector.viewportSize()
    if (box === null || viewport === null) throw new Error('no box to measure')
    expect(box.y).toBeLessThan(viewport.height / 4)
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2)
  })

  test('launching now puts a card on the wall at once', async ({ app, surfaces }) => {
    const { slug, host } = await arrange(app, 'maintenant')
    const { projector } = surfaces
    await projector.goto(wallUrl(app, slug))
    await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
    await expect(projector.locator(CARD)).toHaveCount(0)

    // No `at`: a launch, with no countdown.
    const launched = await host.post(`/api/events/${slug}/announcements`, {
      text: 'Navettes à minuit',
      durationSeconds: 15,
    })
    expect(launched.status).toBe(201)

    await expect(projector.locator(CARD)).toContainText('Navettes à minuit', { timeout: 10_000 })
  })

  test('says nothing of an announcement that is still hours away', async ({ app, surfaces }) => {
    const { slug, host } = await arrange(app, 'secret')
    const { projector } = surfaces
    await projector.goto(wallUrl(app, slug))
    await expect(projector.getByTestId('wall-slide').first()).toBeVisible()

    const armed = await host.post(`/api/events/${slug}/announcements`, {
      text: 'Demande en mariage à 22 h',
      at: inSeconds(2 * 3600),
      durationSeconds: 30,
      countdownSeconds: 300,
    })
    expect(armed.status).toBe(201)

    // The wall is told to read again, and learns nothing: not a card, not a banner, not the text.
    const reply = await projector.request.get(app.url(`/api/events/${slug}/wall`))
    expect(await reply.text()).not.toContain('Demande en mariage')
    await expect(projector.locator(CARD)).toHaveCount(0)
    await expect(projector.locator(BAND)).toHaveCount(0)
  })
})
