import { expect, joinAsGuest, signInAsHost, test, wallUrl } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aClip, aPhoto, hasEncoder } from '../fixtures/media'
import { fr } from '../../../web/src/lib/i18n/fr'
import { frameRateOf, MIN_FRAMES_PER_SECOND } from '../../../web/src/design-system/budget'
import type { Page, TestInfo } from '@playwright/test'
import type { TestApp } from '../fixtures/startTestApp'

/**
 * The budget, measured on a running machine — roadmap 11.3.
 *
 * Everything else about the budget is checked without running anything: the rule
 * (`budget.test.ts`) and the loop over synthetic frames (`useFrameBudget.test.tsx`). None of them can answer the question roadmap 11.3 actually asks, which is
 * not about source: **is the thing holding up while it runs?**
 *
 * ## What is honest to assert here, and what is not
 *
 * A frame rate taken on a shared CI runner is partly a number about the runner, so nothing
 * here asserts a threshold this file invented. What is asserted is:
 *
 * 1. **A runtime fact that does not depend on the machine at all.** Nothing on the wall
 *    resolves a backdrop filter — read off every element the projector actually renders,
 *    rather than off a stylesheet. The glass material is retired (ADR 0012), and this is the
 *    claim that nothing has crept back, measured.
 * 2. **The product's own verdict, plus the floor it is written against.** The wall ships a
 *    monitor that watches its own frames, so the assertion is "this machine, running this
 *    wall, through ten slide changes, did not conclude it had to give anything up" — and,
 *    beside it, that the rate this file measured cleared `MIN_FRAMES_PER_SECOND`. Both are
 *    the shipped rule rather than a stricter one, which is the only kind of frame-rate
 *    assertion that is worth having on hardware nobody controls.
 * 3. **That the verdict bites.** Frames are made late on purpose and the chain is followed
 *    all the way to the computed style: the marker appears, `animation-name` on the wall's
 *    image resolves to `none`, and the crossfade's duration resolves to zero. A budget
 *    that decides something no stylesheet reads is a budget that decides nothing.
 *
 * ## This file is what settled the shipped rule, which is worth recording
 *
 * Two cleverer verdicts were written before the one that shipped — a count of dropped
 * frames, and the share of the display's own frames the wall delivered — and both were
 * discarded because of what was measured *here*, on real walls. `budget.ts` carries the
 * table. The short version: a healthy wall on a loaded machine drops a third of its frames
 * and a wall deliberately crippled to every other frame delivers a *higher* share than a
 * healthy contended one, so neither rule separated the cases it existed to separate. Frames
 * a second did, on every row.
 *
 * The measured rate goes in the test report as well as into an assertion, so that a run
 * creeping towards the floor is visible instead of being a green tick.
 */

/** What the run saw, in the terms the shipped rule is written in. */
interface Cadence {
  readonly frames: number
  readonly framesPerSecond: number
  readonly worstMs: number
}

/**
 * Every interval between paints for `durationMs`, read in the page.
 *
 * `requestAnimationFrame` rather than any of the Chrome-only rendering statistics, because
 * the wall's own monitor reads exactly this and a measurement taken with a different
 * instrument than the one that ships would be measuring a different thing.
 */
const sampleCadence = async (page: Page, durationMs: number): Promise<Cadence> => {
  const intervals = await page.evaluate(async (runFor: number): Promise<number[]> => {
    const measured: number[] = []
    await new Promise<void>((done) => {
      const startedAt = performance.now()
      let previous: number | null = null
      const onPaint = (now: number): void => {
        if (previous !== null) measured.push(now - previous)
        previous = now
        if (now - startedAt >= runFor) done()
        else requestAnimationFrame(onPaint)
      }
      requestAnimationFrame(onPaint)
    })
    return measured
  }, durationMs)

  // The shipped arithmetic rather than a second copy of it: a measurement taken with
  // different sums than the wall's own monitor uses would be a number about this file.
  return {
    frames: intervals.length,
    framesPerSecond: Number(frameRateOf(intervals).toFixed(1)),
    worstMs: Number(Math.max(...intervals, 0).toFixed(2)),
  }
}

/** Numbers go in the report, so a run that scraped through does not read as a clean pass. */
const record = (testInfo: TestInfo, what: string, cadence: Cadence): void => {
  testInfo.annotations.push({
    type: 'measured',
    description: `${what}: ${cadence.frames} frames, ${cadence.framesPerSecond} frames/second (floor ${MIN_FRAMES_PER_SECOND}), worst frame ${cadence.worstMs} ms`,
  })
}

/**
 * Holds the main thread for 80 ms of every frame, for as long as the page lives.
 *
 * A main-thread block rather than a heavier picture, and that is deliberate: what is under
 * test is the monitor and the ladder, not this machine's GPU. Trying to make a real
 * `backdrop-filter` drop frames would produce a test that passes on a laptop with a discrete
 * card and fails on the runner beside it — a test about the hardware, which is exactly what
 * this file says it will not write.
 *
 * **80 ms is measured, not picked.** A 40 ms block on every other frame was here first, and
 * it produced a wall running at 37 frames a second — comfortably above the floor, and in
 * fact indistinguishable from the wall as shipped with eight browsers beside it at 35.7.
 * That is the whole reason the shipped rule is frames per second and not something cleverer,
 * and this number is what makes the case unambiguous: 12.2 frames a second, half the floor.
 */
const makeFramesLate = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const spin = (): void => {
      const until = performance.now() + 80
      while (performance.now() < until) {
        /* holding the main thread, which is what a machine out of budget does */
      }
      requestAnimationFrame(spin)
    }
    requestAnimationFrame(spin)
  })
}

/** Three photographs and, where the machine can make one, a clip under them. */
const seedPlaylist = async (
  app: TestApp,
  surfaces: { guest: Page; host: Page },
  slug: string,
  options: { readonly withClip?: boolean } = {},
) => {
  const event = await app.seedEvent({ slug, name: 'Camille & Sacha' })
  await signInAsHost(surfaces.host, app)

  for (const label of ['confettis', 'gateau', 'discours']) {
    await joinAndUpload(surfaces.guest, app, event.joinCode, {
      displayName: 'Léa',
      caption: label,
      file: await aPhoto(`${slug}-${label}`, 1600, 1200),
    })
  }

  let expected = 3
  if (options.withClip === true) {
    await surfaces.guest.getByTestId('clip-input').setInputFiles(await aClip(`${slug}-clip`, 3))
    await surfaces.guest.getByRole('button', { name: fr.upload.clipSend }).click()
    await expect(surfaces.guest.getByTestId('clip-state')).toHaveAttribute('data-stage', 'done')
    expected = 4
  }

  await surfaces.host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await expect(surfaces.host.getByTestId('moderation-card')).toHaveCount(expected)
  for (let index = 0; index < expected; index += 1) {
    await surfaces.host
      .getByTestId('moderation-card')
      .first()
      .getByRole('button', { name: /Publier/i })
      .click()
    // One at a time, and awaited: `.first()` only publishes a different card each time if
    // the queue has actually shrunk in between.
    await expect(surfaces.host.getByTestId('moderation-card')).toHaveCount(expected - index - 1)
  }

  return event
}

test.describe('the wall, while it is running', () => {
  // One project rather than one engine. `chromium-mobile` is the same instrument on a Pixel
  // 7 viewport, which is not a thing anybody projects from: it would double the cost of the
  // slowest file in the suite to measure a wall nobody runs. A hook rather than the
  // describe-level `test.skip`, because the project's name is on `testInfo` and only a hook
  // is handed one.
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name !== 'chromium-desktop',
      'a projector is a desktop viewport, and two engines would be two numbers',
    )
  })

  test('resolves no backdrop filter on the projector, read off the elements it renders', async ({
    app,
    surfaces,
  }) => {
    // A fact about the DOM the projector actually has, which does not depend on this machine
    // being fast and so can never be flaky: a pane that declared `backdrop-filter` directly,
    // in a third-party stylesheet or an inline style, is caught here instead of at a wedding.
    const { guest, host, projector } = surfaces
    const event = await seedPlaylist(app, { guest, host }, 'salle-cadence')

    await projector.goto(wallUrl(app, event.slug, { intervalMs: 1_200, transitionMs: 600 }))
    await expect(projector.getByTestId('wall-slide').first()).toBeVisible()

    const filtered = await projector.evaluate(() =>
      [...document.querySelectorAll('*')]
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          filter: getComputedStyle(element).backdropFilter,
        }))
        .filter(({ filter }) => filter !== '' && filter !== 'none')
        .map(({ tag, filter }) => `${tag}: ${filter}`),
    )

    expect(filtered).toEqual([])
  })

  test('holds its cadence through ten slide changes, by its own measure', async ({
    app,
    surfaces,
  }, testInfo) => {
    const { guest, host, projector } = surfaces
    const event = await seedPlaylist(app, { guest, host }, 'salle-dix-photos')

    // A real crossfade rather than the suite's usual cut: the transition is the expensive
    // moment and measuring the wall with it switched off would be measuring a still.
    await projector.goto(wallUrl(app, event.slug, { intervalMs: 1_200, transitionMs: 600 }))
    await expect(projector.getByTestId('wall-slide').first()).toBeVisible()

    // Twelve seconds at 1.2 s a slide: ten changes, which is the number §13's human check
    // asks a person to sit through with the frame counter open.
    const cadence = await sampleCadence(projector, 12_000)
    record(testInfo, 'the wall as shipped', cadence)

    // The wall's own verdict, which is the only frame-rate floor that means the same thing
    // on a venue mini-PC and on a CI runner. Nothing shed means the monitor watched ten
    // crossfades on this machine and found nothing it had to take away.
    await expect(projector.locator('[data-wall-budget]')).toHaveCount(0)

    // And the instrument agrees, at the two bounds the rule is written in. These are the
    // product's own thresholds rather than numbers invented here, and the margin between
    // the measurement and them is what the annotation above puts in the report.
    expect(cadence.frames).toBeGreaterThan(100)
    expect(cadence.framesPerSecond).toBeGreaterThanOrEqual(MIN_FRAMES_PER_SECOND)
  })

  test('holds it with a clip decoding under the crossfade @slow', async ({
    app,
    surfaces,
  }, testInfo) => {
    // The machine roadmap 11.3 names: "the wall must hold its frame rate through a
    // crossfade with a clip playing". The spotlight is the layout that plays one, so this
    // is a scale, a decode and a dissolve at once — the worst frame the room ever sees.
    test.skip(
      !hasEncoder(),
      'no ffmpeg on this machine: a clip fixture cannot be built (CI has ffmpeg-static)',
    )
    test.slow()

    const { guest, host, projector } = surfaces
    const event = await seedPlaylist(app, { guest, host }, 'salle-avec-clip', { withClip: true })

    await projector.goto(
      wallUrl(app, event.slug, { layout: 'spotlight', intervalMs: 1_200, transitionMs: 600 }),
    )
    await expect(projector.getByTestId('wall-slide').first()).toBeVisible()

    const cadence = await sampleCadence(projector, 12_000)
    record(testInfo, 'the wall with a clip in the playlist', cadence)

    await expect(projector.locator('[data-wall-budget]')).toHaveCount(0)
    expect(cadence.framesPerSecond).toBeGreaterThanOrEqual(MIN_FRAMES_PER_SECOND)
  })

  test('gives up the zoom, and then the fade, on a machine that cannot keep up', async ({
    app,
    surfaces,
  }) => {
    // The other half, and the half that would otherwise be a comment. A monitor that never
    // fires is indistinguishable from no monitor at all, so the frames are made late on
    // purpose and the chain is followed to the computed style: the rule, the marker, the
    // stylesheet, the rendering.
    //
    // Slow because the arithmetic makes it slow, and the timeouts are generous for the same
    // reason. A window is `FRAME_WINDOW` frames and a rung is two of them, so reaching the
    // second rung means four windows — and a window can only miss its floor by wasting most
    // of its time, which is what makes each one take three or four times as long as ninety
    // frames should. Under a full suite it measured past thirty seconds.
    test.slow()

    const { guest, host, projector } = surfaces
    const event = await seedPlaylist(app, { guest, host }, 'salle-a-bout')

    await projector.goto(wallUrl(app, event.slug, { intervalMs: 1_200, transitionMs: 600 }))
    const slide = projector.getByTestId('wall-slide').first()
    await expect(slide).toBeVisible()

    // Ken Burns is running, which is what makes the assertion after the block mean
    // something. `toContain` because CSS Modules hashes the keyframe name into the bundle:
    // asserting the bare name passes only until the next build, which is a test that fails
    // for a reason nobody wants to read about.
    const image = slide.locator('img').first()
    expect(await image.evaluate((element) => getComputedStyle(element).animationName)).toContain(
      'ken-burns',
    )

    await makeFramesLate(projector)

    // The zoom first: it runs on every frame of every slide, so it is the biggest saving
    // and the smallest loss. The order is `SHED_ORDER`'s, and this is it happening.
    await expect(projector.locator('[data-wall-budget]')).toHaveAttribute(
      'data-wall-budget',
      'still',
      { timeout: 60_000 },
    )
    expect(await image.evaluate((element) => getComputedStyle(element).animationName)).toBe('none')

    // Then the fade, if the machine is still in trouble. Slides cut, which is exactly what
    // a viewer who asked for reduced motion already sees.
    await expect(projector.locator('[data-wall-budget]')).toHaveAttribute(
      'data-wall-budget',
      'cut',
      { timeout: 90_000 },
    )
    const layer = projector.locator('[data-testid="wall-slide"]').first()
    expect(await layer.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
      '0s',
    )

    // And it reaches a layout that is not the spotlight, which is the half that shipped
    // broken: the rungs were declared only in `SlideLayer.module.css`, so on the mosaic — one
    // keypress away, and the layout a host reaches for during a cocktail hour — the wall
    // concluded there was nothing left to give while every tile went on animating. The
    // attribute is on the wall's root, so the layout the room is looking at inherits the
    // verdict already taken rather than needing it taken again.
    await projector.keyboard.press('l')
    await expect(projector.locator('[data-wall-layout]')).toHaveAttribute(
      'data-wall-layout',
      'mosaic',
    )
    const tile = projector.getByTestId('wall-slide').first().locator('img').first()
    expect(await tile.evaluate((element) => getComputedStyle(element).animationName)).toBe('none')
  })
})

test.describe('the guest surface', () => {
  test('resolves no backdrop filter on any element, and paints its pane opaque', async ({
    app,
    surfaces,
  }) => {
    // The glass material is retired (ADR 0012): the composer is `--surface-raised` and nothing
    // the guest's phone renders blurs what is behind it, which is read off the resolved style
    // of every element rather than off a stylesheet.
    const { guest } = surfaces
    const event = await app.seedEvent({ slug: 'envoi-opaque', name: 'Camille & Sacha' })

    await joinAsGuest(guest, app, event.joinCode, 'Léa')
    const composer = guest.getByTestId('upload-composer')
    await expect(composer).toBeVisible()

    const filtered = await guest.evaluate(() =>
      [...document.querySelectorAll('*')]
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          filter: getComputedStyle(element).backdropFilter,
        }))
        .filter(({ filter }) => filter !== '' && filter !== 'none')
        .map(({ tag, filter }) => `${tag}: ${filter}`),
    )
    expect(filtered).toEqual([])

    const background = await composer.evaluate((element) => getComputedStyle(element).background)
    expect(background).not.toContain('rgba')
  })
})
