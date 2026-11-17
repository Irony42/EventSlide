import { csrfHeaders, expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'
import { MIN_FRAMES_PER_SECOND } from '../../../web/src/design-system/budget'
import { record, sampleCadence } from './cadence'

/**
 * The film look's measured budget — spec 23 section 8, roadmap 11.3 and 2.11.
 *
 * `.filmLook` is a CSS filter on the image the wall draws. It is the one place the disposable-camera
 * mode can cost a projector frames, so the spec asked for a measurement **before** the look shipped on
 * the wall, not an assumption: the same wall, the same nine photographs, the same instrument as
 * `frame-budget.spec.ts` (the intervals between the page's own paints), once without the look and once
 * with it, on the layouts that are the most expensive to draw.
 *
 * ## What was measured (a software-rendered Chromium on a desktop, so the worst case a projector's
 * ## machine can be: nothing is composited on a GPU)
 *
 * | layout                                 | without | full look (5 functions) | light look (1 function) |
 * | -------------------------------------- | ------- | ----------------------- | ----------------------- |
 * | spotlight (Ken Burns under a crossfade) | 46      | 19                      | 27                      |
 * | mosaic, polaroid, filmstrip, collage, split | 58-60 | 58-60              | 58-60                   |
 * | clothesline (already the heaviest)     | 43      | 45                      | 45                      |
 *
 * Frames a second, over 6 to 9 seconds each. One layout pays and it is the one where the animated
 * element is the filtered one: the Ken Burns zoom scales the image, so the compositor filters a
 * full-screen picture on every frame. With the zoom off the same filter costs nothing (57 against 57),
 * which is what the wall's first rung already does for a machine in trouble. The wall therefore wears
 * the **light** look (`WallMedia.module.css`, one function: the spec's own first fallback), and the
 * ladder of `budget.ts` stays the safety net under it.
 *
 * ## What is asserted
 *
 * Nothing the runner can move on its own account, and nothing this file invented:
 *
 * 1. the look really is on the pixels being measured (the computed `filter` of the image), and really
 *    absent without it, so the "with" row can never be the "without" row twice;
 * 2. the layouts that do not animate the image hold the shipped floor straight away;
 * 3. the spotlight holds it **at the latest after the wall's own ladder has acted**: up to four windows,
 *    the first of which is the raw cost of the look (recorded, never asserted), and never by cutting
 *    the crossfade (`data-wall-budget="cut"`): the film look may cost the zoom on a machine that cannot
 *    afford both, and must not cost the dissolve.
 */
const OTHER_LAYOUTS = ['mosaic', 'clothesline'] as const
const PHOTOS = 9
const WINDOW_MS = 6_000
const SPOTLIGHT_WINDOWS = 4

test.describe('the film look on the projector', () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name !== 'perf',
      'a projector is a desktop viewport, and two engines would be two numbers',
    )
  })

  test('keeps the wall inside its budget with the look on, on its most expensive layouts', async ({
    app,
    surfaces,
  }, testInfo) => {
    test.slow()
    const { guest, host, projector } = surfaces
    const event = await app.seedEvent({ slug: 'salle-pellicule', name: 'Camille & Sacha' })
    await signInAsHost(host, app)
    const headers = await csrfHeaders(host.request, app)
    const settings = app.url(`/api/events/${event.slug}/settings`)

    // `auto`, so the photographs are on the wall as they arrive: they are the measurement's input and
    // moderating nine of them by hand would be the measurement's whole cost.
    const saved = await host.request.patch(settings, {
      headers,
      data: { moderation: 'auto', reveal: { enabled: true, film: false } },
    })
    expect(saved.ok()).toBe(true)
    for (let index = 0; index < PHOTOS; index += 1) {
      await joinAndUpload(guest, app, event.joinCode, {
        displayName: 'Léa',
        caption: `pose ${index + 1}`,
        file: await aPhoto(`pellicule-${index}`, 1920, 1280),
      })
    }
    // The evening is revealed, so the wall draws them; the film switch is then the only variable.
    const revealed = await host.request.post(app.url(`/api/events/${event.slug}/reveal`), {
      headers,
    })
    expect(revealed.ok()).toBe(true)

    const open = async (layout: string, film: boolean) => {
      const patched = await host.request.patch(settings, { headers, data: { reveal: { film } } })
      expect(patched.ok()).toBe(true)
      await projector.goto(
        wallUrl(app, event.slug, { layout, intervalMs: 1_200, transitionMs: 600 }),
      )
      await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
      const image = projector.locator('[data-wall-layout] img').first()
      await expect(image).toBeVisible()
      const filter = await image.evaluate((element) => getComputedStyle(element).filter)
      if (film) expect(filter).not.toBe('none')
      else expect(filter).toBe('none')
    }

    for (const layout of OTHER_LAYOUTS) {
      await open(layout, false)
      record(testInfo, `${layout} without the look`, await sampleCadence(projector, WINDOW_MS))
      await open(layout, true)
      const withLook = await sampleCadence(projector, WINDOW_MS)
      record(testInfo, `${layout} with the look`, withLook)
      await expect(projector.locator('[data-wall-budget]')).toHaveCount(0)
      expect(withLook.framesPerSecond).toBeGreaterThanOrEqual(MIN_FRAMES_PER_SECOND)
    }

    await open('spotlight', false)
    record(testInfo, 'spotlight without the look', await sampleCadence(projector, WINDOW_MS))
    await open('spotlight', true)
    let held = false
    for (let window = 1; window <= SPOTLIGHT_WINDOWS && !held; window += 1) {
      const cadence = await sampleCadence(projector, WINDOW_MS)
      record(testInfo, `spotlight with the look, window ${window}`, cadence)
      // The crossfade is the last thing the ladder gives up and the film look must not take it.
      await expect(projector.locator('[data-wall-budget="cut"]')).toHaveCount(0)
      held = cadence.framesPerSecond >= MIN_FRAMES_PER_SECOND
    }
    expect(held).toBe(true)
  })
})
