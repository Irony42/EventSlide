import {
  expect,
  csrfHeaders,
  projectorContextOptions,
  signInAsHost,
  test,
  wallUrl,
} from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'

/**
 * Spec 23, the room: a disposable-camera evening shows the projector nothing until its hour, then
 * every screen opens by itself, whatever its own clock says.
 *
 * Real time, on purpose: the hour is decided by the server's clock, which a page cannot move, so the
 * reveal is set a few seconds ahead and the screens are given clocks five minutes apart with
 * `page.clock.install` (not paused: they run, only their idea of "now" is wrong). A screen that
 * counted down against its own clock would open five minutes early or late.
 */
const REVEAL_IN_MS = 15_000
/** The jitter is 0 to 3 seconds and a read takes a moment: two screens open within this of each other. */
const TOGETHER_MS = 6_000

test('the room sees an invitation and a count, no photograph, then two screens on skewed clocks open together', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host, guest, projector } = surfaces
  const event = await app.seedEvent({ slug: 'jetable', name: 'Camille & Sacha' })
  await signInAsHost(host, app)

  const headers = await csrfHeaders(host.request, app)
  const saved = await host.request.patch(app.url(`/api/events/${event.slug}/settings`), {
    headers,
    // `auto`, so the guest's photograph is published and is what the gate holds back.
    data: {
      moderation: 'auto',
      reveal: { enabled: true, at: new Date(Date.now() + 60_000).toISOString() },
    },
  })
  expect(saved.ok()).toBe(true)

  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Invité' })

  // A second projector, with a clock five minutes behind the server's, and the first one five ahead.
  const second = await browser.newContext(projectorContextOptions(app))
  const other = await second.newPage()
  try {
    const behind = Date.now() - 5 * 60_000
    const ahead = Date.now() + 5 * 60_000
    await projector.clock.install({ time: ahead })
    await other.clock.install({ time: behind })
    const url = wallUrl(app, event.slug)
    await projector.goto(url)
    await other.goto(url)

    for (const screen of [projector, other]) {
      await expect(screen.getByTestId('wall-empty')).toBeVisible()
      // The invitation stays, the hour and the count are added, and nothing of the evening is shown.
      await expect(screen.getByTestId('wall-join')).toBeVisible()
      await expect(screen.getByTestId('wall-reveal-at')).toContainText('Révélation')
      await expect(screen.getByTestId('wall-reveal-count')).toHaveText(
        '1 photo en cours de développement',
      )
      await expect(screen.getByTestId('wall-slide')).toHaveCount(0)
      await expect(screen.locator('img[src*="/photos/"]')).toHaveCount(0)
    }

    // The hour is moved a few seconds ahead of now, which the settings page allows while it is future.
    const moved = await host.request.patch(app.url(`/api/events/${event.slug}/settings`), {
      headers,
      data: { reveal: { at: new Date(Date.now() + REVEAL_IN_MS).toISOString() } },
    })
    expect(moved.ok()).toBe(true)

    // Both open by themselves, from their own timers, with no reload and no signal at the hour.
    const opened = (screen: typeof projector): Promise<number> =>
      expect(screen.getByTestId('wall-slide'))
        .toBeVisible({ timeout: REVEAL_IN_MS + 20_000 })
        .then(() => Date.now())
    const [first, last] = await Promise.all([opened(projector), opened(other)])

    expect(Math.abs(first - last)).toBeLessThan(TOGETHER_MS)
    for (const screen of [projector, other]) {
      await expect(screen.getByTestId('wall-reveal')).toHaveCount(0)
    }
  } finally {
    await second.close()
  }

  // The photograph the evening was holding is the one the room now looks at.
  await expect(projector.getByTestId('wall-slide')).toHaveAttribute('data-photo-id', /.+/)
})
