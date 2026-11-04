import { expect, csrfHeaders, signInAsHost, test, wallUrl } from '../fixtures/app'

/**
 * The mixed wall (spec 09): two projectors on one event read the same phase, and the host
 * switching the mode on reaches both without a reload.
 *
 * Only the phase is shared, not the photograph: the assertion is on `data-wall-phase`, never
 * on what is in the frame. `e2e_phase_ms` makes both halves 800 ms on the screen that asks for
 * it (the anchor stays the server's), so a cycle is a second and a half, not four minutes.
 */
test('two projectors agree on the phase, and the host turning the mode on reaches both', async ({
  app,
  surfaces,
  browser,
}) => {
  const event = await app.seedEvent({ slug: 'mixte', name: 'Camille & Sacha' })
  const { host, projector } = surfaces
  await signInAsHost(host, app)

  const second = await browser.newContext({ baseURL: app.baseUrl })
  const other = await second.newPage()
  try {
    const url = `${wallUrl(app, event.slug)}&e2e_phase_ms=800`
    await projector.goto(url)
    await other.goto(url)
    // Off: nothing is said of phases.
    await expect(projector.locator('[data-wall-layout]')).toBeVisible()
    await expect(projector.locator('[data-wall-phase]')).toHaveCount(0)

    const headers = await csrfHeaders(host.request, app)
    const saved = await host.request.patch(app.url(`/api/events/${event.slug}/settings`), {
      headers,
      data: { wall: { mixedEnabled: true } },
    })
    expect(saved.ok()).toBe(true)

    // The settings signal reaches both open screens; both start on the wall half.
    await expect(projector.locator('[data-wall-phase="wall"]')).toBeVisible()
    await expect(other.locator('[data-wall-phase]')).toBeVisible()

    // Sampled together: the two never disagree for longer than the clock's own error.
    const phases = async () =>
      Promise.all(
        [projector, other].map((page) =>
          page.locator('[data-wall-layout]').getAttribute('data-wall-phase'),
        ),
      )
    await expect
      .poll(async () => (await phases()).includes('slideshow'), { timeout: 5_000 })
      .toBe(true)
    await expect
      .poll(
        async () => {
          const [one, two] = await phases()
          return one === two
        },
        { timeout: 5_000 },
      )
      .toBe(true)
  } finally {
    await second.close()
  }
})
