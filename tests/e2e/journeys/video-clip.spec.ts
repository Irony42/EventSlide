import { expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { aClip, hasEncoder } from '../fixtures/media'
import { fr } from '../../../web/src/lib/i18n/fr'
import type { Page } from '@playwright/test'
import type { TestApp } from '../fixtures/startTestApp'

/**
 * A guest films fifteen seconds, and it ends up playing on a projector.
 *
 * Everything cheaper is already covered: the refusals and the job's states at ring 5
 * against a fake transport, the route and its `202` at ring 4, the layout table at ring 1
 * with a source-level guard between the domain and the client's mirror. What is left is
 * the part that only exists in a browser, and there are exactly three things:
 *
 * 1. **A real `<video>` decoding a real transcode.** Every ring below this one asserts
 *    against an element jsdom never gave a media pipeline to. Whether the file the box
 *    produced is one a browser will actually open is not a question a fake can answer.
 * 2. **The autoplay policy.** "A muted video is allowed to start itself" is a rule
 *    enforced by the user agent, not by anything in this repository. The wall runs
 *    unattended for eight hours with nobody to press play, so the assumption is tested
 *    rather than trusted — and the fallback to the poster is tested with it.
 * 3. **Play against swipe.** `touch-action: pan-y` on the moderation card and a media
 *    element inside it are two things that only meet on a real touch stack.
 *
 * ## Why this file can skip
 *
 * Making the fixture needs an encoder, and so does the server under test. On CI the
 * `ffmpeg-static` devDependency provides one; on a laptop it is whatever is on `PATH`. A
 * worktree whose `node_modules` is a junction to another checkout has neither of the
 * static packages, and this branch has already paid once for treating "green locally" as
 * "green" under exactly that condition. So the skip is named and loud rather than a
 * silently empty file.
 */
test.skip(
  () => !hasEncoder(),
  'no ffmpeg on this machine: a clip fixture cannot be built (CI has ffmpeg-static)',
)

/** Long enough to still be running when the assertions land, short to transcode. */
const CLIP_SECONDS = 3

/**
 * Sends one clip through the real guest screen and waits for the box to finish with it.
 *
 * The wait is on the surface's own success message rather than on a timeout: the clip
 * crosses a multipart upload, a reserved row, a queue, an ffmpeg process and a database
 * write, and how long that takes on the machine running the suite is not something a test
 * should guess at.
 */
const sendClip = async (
  page: Page,
  app: TestApp,
  joinCode: string,
  displayName: string,
): Promise<void> => {
  await page.goto(app.url(`/join/${joinCode}`))
  await page.getByLabel(/Votre prénom/i).fill(displayName)
  await page.getByRole('button', { name: /Rejoindre/i }).click()
  await page.waitForURL(/\/e\/[^/]+\/upload/)

  await page.getByTestId('clip-input').setInputFiles(await aClip('journey', CLIP_SECONDS))
  await page.getByRole('button', { name: fr.upload.clipSend }).click()

  // The states the server actually reports, in order. A screen that stopped at 100% and
  // said nothing while the box worked is the failure the status endpoint exists for.
  await expect(page.getByTestId('clip-state')).toHaveAttribute('data-stage', 'done')
  await expect(page.getByText(fr.upload.clipDone)).toBeVisible()
}

test('a clip a guest films plays on the wall once the host publishes it @smoke', async ({
  app,
  surfaces,
}) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'premiere-danse', name: 'Camille & Sacha' })

  await projector.goto(wallUrl(app, event.slug, { layout: 'spotlight' }))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()

  await sendClip(guest, app, event.joinCode, 'Léa')

  // The host's console. A clip is a facet of a photo, so it arrives in the same queue,
  // over the same stream, with the same three decisions on it.
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  const card = host.getByTestId('moderation-card')
  await expect(card).toBeVisible()
  await expect(card.getByText(fr.moderation.videoLength(CLIP_SECONDS))).toBeVisible()

  // And it can be watched, which is the whole reason the lightbox exists for a clip: a
  // poster frame is not a decision about three seconds of video.
  await host.getByRole('button', { name: fr.moderation.watchVideo('Léa') }).click()
  const player = host.getByRole('dialog').locator('video')
  await expect(player).toBeVisible()
  await expect
    .poll(async () => player.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThan(0)

  await host.getByRole('dialog').getByRole('button', { name: fr.moderation.publish }).click()

  // The room. `wall-slide` is the element the wall names its current item on, and this is
  // the first point in the whole journey where the bytes the phone sent are on a screen.
  const slide = projector.getByTestId('wall-slide').first()
  await expect(slide).toBeVisible()
  const wallVideo = slide.locator('video')
  await expect(wallVideo).toBeVisible()

  // Muted, and it is load-bearing twice: a wall that asks for sound in a room with a DJ
  // is a wall nobody hears, and an unmuted video is one no browser starts by itself.
  expect(await wallVideo.evaluate((element: HTMLVideoElement) => element.muted)).toBe(true)

  // Autoplay, tested rather than trusted. A projector has nobody standing at it, so a
  // clip that needs a click is a black slot for the rest of the evening.
  await expect
    .poll(async () => wallVideo.evaluate((element: HTMLVideoElement) => element.currentTime), {
      message: 'the wall never started playing the clip',
    })
    .toBeGreaterThan(0)
  expect(await wallVideo.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
})

test('the wall shows a clip’s poster in a layout that does not play it', async ({
  app,
  surfaces,
}) => {
  // `collage` holds twelve slots, and twelve simultaneous decodes is not a slower wall,
  // it is a stuttering one on a venue mini-PC that is also driving the projector. The
  // still costs the layout nothing: a clip's `displayUrl` is already its poster frame.
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'collage-sans-video' })

  await sendClip(guest, app, event.joinCode, 'Tom')
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await host.getByRole('button', { name: fr.moderation.publishPhoto('Tom') }).click()

  await projector.goto(wallUrl(app, event.slug, { layout: 'collage' }))
  const slide = projector.getByTestId('wall-slide').first()
  await expect(slide).toBeVisible()

  await expect(slide.locator('video')).toHaveCount(0)
  await expect(slide.locator('img')).toHaveAttribute('src', /\/poster$/)
})

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'the phone console is asserted on the phone projects')

  test('playing a clip does not take the swipe away from the host', async ({
    app,
    page,
    surfaces,
  }) => {
    /**
     * The interaction no cheaper ring can answer, in the two halves it actually has.
     *
     * The gesture below is driven through `page.mouse`, which is honest about what it
     * covers: `useSwipeDecision` listens for **pointer** events, and a mouse produces
     * them, so this proves a running `<video>` does not break the pointer pipeline the
     * decision travels on. It does **not** exercise `touch-action`, which a browser
     * consults for touch and pen input only — and Playwright's touchscreen API has taps
     * but no drag, so there is no cross-browser way to swipe with a finger here.
     *
     * So the other half is asserted directly, as computed style. The browser intersects
     * `touch-action` from the hit element up through its ancestors, so a `<video>` that
     * declared `auto` would hand the horizontal axis back to the scroller and let a real
     * thumb's swipe be stolen halfway through — the exact failure
     * `SwipeCard.module.css` documents, and one that no amount of mouse input can show.
     */
    const { guest, projector } = surfaces
    const event = await app.seedEvent({ slug: 'video-au-pouce' })

    await projector.goto(wallUrl(app, event.slug))
    await expect(projector.getByTestId('wall-empty')).toBeVisible()

    await signInAsHost(page, app)
    await page.goto(app.url(`/admin/events/${event.slug}/moderation/mobile`))
    await sendClip(guest, app, event.joinCode, 'Léa')

    const card = page.getByTestId('mobile-moderation-card')
    await expect(card).toBeVisible()

    // The play control is a real button in the action bar, below the card — never inside
    // it, because a button in a drag surface fires on a gesture meant for the card.
    await page.getByRole('button', { name: fr.moderation.playVideo('Léa') }).click()
    const player = card.locator('video')
    await expect
      .poll(async () => player.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0)

    // The card still owns the horizontal axis with a clip inside it, as computed by a
    // real engine rather than as written in a stylesheet. A browser intersects
    // `touch-action` from the hit element up to the scroll container, so this one value
    // is what decides whether a thumb's swipe reaches the card or becomes a scroll —
    // and it is the line `SwipeCard.module.css` calls load-bearing.
    expect(await card.evaluate((element) => getComputedStyle(element).touchAction)).toBe('pan-y')

    // And now the gesture, with the clip running under the thumb.
    await card.scrollIntoViewIfNeeded()
    const box = await card.boundingBox()
    expect(box).not.toBeNull()
    const y = box!.y + box!.height / 2
    const from = box!.x + box!.width / 2

    await page.mouse.move(from, y)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width - 4, y, { steps: 10 })
    await expect(card).toHaveAttribute('data-committed', 'true')
    await page.mouse.up()

    await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
  })

  test('the play control meets the 44 px touch floor', async ({ app, page, surfaces }) => {
    // docs/DESIGN-SYSTEM.md section 8. Measured in a real layout, because a minimum
    // expressed in CSS is a claim about the rendered box rather than about the rule.
    const { guest } = surfaces
    const event = await app.seedEvent({ slug: 'cible-lecture' })

    await signInAsHost(page, app)
    await page.goto(app.url(`/admin/events/${event.slug}/moderation/mobile`))
    await sendClip(guest, app, event.joinCode, 'Léa')

    const play = page.getByRole('button', { name: fr.moderation.playVideo('Léa') })
    await expect(play).toBeVisible()
    const box = await play.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })
})
