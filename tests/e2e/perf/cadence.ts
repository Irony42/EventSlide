import { expect, signInAsHost } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aClip, aPhoto } from '../fixtures/media'
import { fr } from '../../../web/src/lib/i18n/fr'
import { frameRateOf, MIN_FRAMES_PER_SECOND } from '../../../web/src/design-system/budget'
import type { Page, TestInfo } from '@playwright/test'
import type { TestApp } from '../fixtures/startTestApp'

/**
 * What the frame-rate specs share: the instrument and the playlist it measures.
 *
 * Moved out of `frame-budget.spec.ts` when `film-look.spec.ts` (spec 23, the film look's measured
 * budget) needed the same instrument: a measurement taken with a second copy of it would be a number
 * about the copy. Not a spec itself (`PERF_SPECS` only matches `*.spec.ts`).
 */

/** What the run saw, in the terms the shipped rule is written in. */
export interface Cadence {
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
export const sampleCadence = async (page: Page, durationMs: number): Promise<Cadence> => {
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
export const record = (testInfo: TestInfo, what: string, cadence: Cadence): void => {
  testInfo.annotations.push({
    type: 'measured',
    description: `${what}: ${cadence.frames} frames, ${cadence.framesPerSecond} frames/second (floor ${MIN_FRAMES_PER_SECOND}), worst frame ${cadence.worstMs} ms`,
  })
}

/** Three photographs and, where the machine can make one, a clip under them. */
export const seedPlaylist = async (
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
