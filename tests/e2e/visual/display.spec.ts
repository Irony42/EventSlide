import { expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'

/**
 * Visual regression, and only where "looks right" *is* the requirement.
 *
 * Restricted to the wall on purpose. A snapshot of a form tells you a button moved four
 * pixels and fails on a font-rendering difference between two machines; a snapshot of
 * the projected surface catches the class of regression that matters here — a caption
 * that has become unreadable, a photo that has started being cropped, a layout that
 * collapsed — and none of those have a non-visual assertion that is honest.
 *
 * Only `chromium-desktop` runs these. Font rasterisation differs between engines, so
 * three browsers would mean three snapshot sets and three ways to be flaky for no extra
 * information.
 *
 * The display URL's `?layout=` now selects the layout, read in the browser by
 * `web/src/features/wall/hooks/useLayoutParam.ts`; the server no longer accepts a
 * layout at all. These tests still reach the mosaic with the host's `L` shortcut
 * instead, because a baseline is only worth what the assertion in front of it is worth:
 * `?layout=` was dead for four baseline generations and every one of them quietly
 * photographed the spotlight. Counting the tiles before the shot is what caught that,
 * so the count stays and the route to the layout stays the one a person takes. That the
 * URL reaches the same place is proved without a snapshot in
 * `tests/e2e/journeys/display-wall.spec.ts`.
 */

test.describe('the projected wall @visual', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'snapshots are taken on one engine; font rasterisation differs between them',
  )

  /**
   * A fixed album: the same six photos, the same captions, the same order, every run.
   * Deterministic colours from the labels rather than real photographs, so a snapshot
   * diff is always a layout change and never a JPEG-encoder difference.
   */
  const seedAlbum = async (
    app: Parameters<typeof signInAsHost>[1],
    surfaces: {
      guest: Parameters<typeof joinAndUpload>[0]
      host: Parameters<typeof signInAsHost>[0]
    },
    slug: string,
  ) => {
    const event = await app.seedEvent({ slug, name: 'Camille & Sacha' })
    await signInAsHost(surfaces.host, app)
    await surfaces.host.goto(app.url(`/admin/events/${event.slug}/moderation`))

    const album = [
      { label: 'confettis', caption: 'Les confettis', width: 1600, height: 1200 },
      { label: 'gateau', caption: 'Le gâteau', width: 1200, height: 1600 },
      { label: 'discours', caption: 'Le discours', width: 1600, height: 1067 },
      { label: 'danse', caption: 'La première danse', width: 1067, height: 1600 },
      { label: 'table', caption: 'La table 4', width: 1600, height: 1200 },
      { label: 'sortie', caption: 'La sortie', width: 1600, height: 900 },
    ]

    for (const photo of album) {
      await joinAndUpload(surfaces.guest, app, event.joinCode, {
        displayName: 'Léa',
        caption: photo.caption,
        file: await aPhoto(`${slug}-${photo.label}`, photo.width, photo.height),
      })
    }

    await expect(surfaces.host.getByTestId('moderation-card')).toHaveCount(album.length)
    for (let index = 0; index < album.length; index += 1) {
      await surfaces.host
        .getByTestId('moderation-card')
        .first()
        .getByRole('button', { name: /Publier/i })
        .click()
    }
    return event
  }

  test('the empty state, which is what the room sees first', async ({ app, surfaces }) => {
    // Twenty minutes of an evening are spent looking at this screen. It is the most
    // seen view in the product and the one with no data to hide behind.
    const event = await app.seedEvent({ slug: 'vide', name: 'Camille & Sacha' })
    const { projector } = surfaces

    await projector.goto(wallUrl(app, event.slug, { transitionMs: 0 }))
    await expect(projector.getByTestId('wall-empty')).toBeVisible()

    // Snapshotting the copy, not the page, and masking is not enough to get there.
    //
    // The join code is random per event, and `.join` is a content-sized grid, so a code
    // of wide characters makes that block wider and pushes its flex sibling across the
    // screen. Masking the block hides its pixels but not the shift it caused, which is
    // why a full-page baseline here failed intermittently — sometimes 3% of pixels,
    // sometimes 5%, depending on which six characters the server generated.
    //
    // An element screenshot clips to the element, so the copy's own typography and
    // spacing are captured regardless of where the sibling pushed it. That is what this
    // test is for: a caption gone unreadable, a heading that stopped fitting. The join
    // block's presence is asserted structurally just above, and the code's value is
    // covered by the journeys, which read it off this screen and join with it.
    await expect(projector.getByTestId('wall-empty-copy')).toHaveScreenshot('wall-empty.png', {
      animations: 'disabled',
    })
  })

  test('the spotlight layout', async ({ app, surfaces }) => {
    const event = await seedAlbum(app, surfaces, 'spotlight')
    const { projector } = surfaces

    await projector.goto(wallUrl(app, event.slug, { intervalMs: 600_000, transitionMs: 0 }))
    await expect(projector.getByTestId('wall-slide')).toHaveCount(1)

    // A very long interval, so the wall is not mid-advance when the shot is taken.
    await expect(projector).toHaveScreenshot('wall-spotlight.png', { animations: 'disabled' })
  })

  test('the mosaic layout', async ({ app, surfaces }) => {
    const event = await seedAlbum(app, surfaces, 'mosaique')
    const { projector } = surfaces

    await projector.goto(wallUrl(app, event.slug, { intervalMs: 600_000, transitionMs: 0 }))
    await expect(projector.getByTestId('wall-slide')).toHaveCount(1)

    // `L` is the host's layout shortcut. Asserting six tiles before the shot is what
    // keeps this test honest: a spotlight has one, so a silent fall back to it fails
    // here rather than in a snapshot diff nobody reads.
    await projector.keyboard.press('l')
    await expect(projector.getByTestId('wall-slide')).toHaveCount(6)

    await expect(projector).toHaveScreenshot('wall-mosaic.png', { animations: 'disabled' })
  })

  test('the spotlight layout under reduced motion', async ({ app, surfaces, browser }) => {
    // Reduced motion is a health requirement, not a preference: Ken Burns and the
    // crossfade can trigger vestibular symptoms. The still frame has to be a finished
    // composition rather than the first frame of an animation that never runs.
    const event = await seedAlbum(app, surfaces, 'sobre')

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      baseURL: app.baseUrl,
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    await page.goto(wallUrl(app, event.slug, { intervalMs: 600_000, transitionMs: 0 }))
    await expect(page.getByTestId('wall-slide')).toHaveCount(1)

    await expect(page).toHaveScreenshot('wall-spotlight-reduced-motion.png', {
      animations: 'disabled',
    })

    await context.close()
  })
})
