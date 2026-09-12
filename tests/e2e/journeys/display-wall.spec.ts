import { expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'

/**
 * The projected wall.
 *
 * Everything here is about a screen nobody is standing at. The failure modes worth
 * testing are not "does it render" but "does it still work at 1 a.m." — after a
 * reconnect, after fifty photos, after the playlist changed under it.
 */

/** Publishes `count` photos into a fresh event and returns it. */
const anEventWithPublishedPhotos = async (
  app: Parameters<typeof signInAsHost>[1],
  surfaces: {
    guest: Parameters<typeof joinAndUpload>[0]
    host: Parameters<typeof signInAsHost>[0]
  },
  count: number,
  slug: string,
) => {
  const event = await app.seedEvent({ slug, name: 'Camille & Sacha' })
  await signInAsHost(surfaces.host, app)
  await surfaces.host.goto(app.url(`/admin/events/${event.slug}/moderation`))

  for (let index = 0; index < count; index += 1) {
    await joinAndUpload(surfaces.guest, app, event.joinCode, {
      displayName: `Invité ${index + 1}`,
      caption: `Photo ${index + 1}`,
      file: await aPhoto(`wall-${slug}-${index}`, 1200, 900),
    })
  }

  await expect(surfaces.host.getByTestId('moderation-card')).toHaveCount(count)
  for (let index = 0; index < count; index += 1) {
    await surfaces.host
      .getByTestId('moderation-card')
      .first()
      .getByRole('button', { name: /Publier/i })
      .click()
  }
  return event
}

test('the empty state tells the room how to join', async ({ app, surfaces }) => {
  // This is what two hundred people look at for the first twenty minutes. A blank
  // screen is a wasted twenty minutes of uploads.
  const { projector } = surfaces
  const event = await app.seedEvent({ slug: 'mariage', name: 'Camille & Sacha' })

  await projector.goto(wallUrl(app, event.slug))

  const empty = projector.getByTestId('wall-empty')
  await expect(empty).toBeVisible()
  await expect(empty.getByText('Camille & Sacha')).toBeVisible()
  await expect(empty.getByText(event.joinCode)).toBeVisible()
  // Rendered as inline SVG, never a remote image: the CSP forbids one and venue Wi-Fi
  // would drop it.
  await expect(empty.locator('svg')).toBeVisible()
})

test('the slideshow advances and wraps', async ({ app, surfaces }) => {
  const event = await anEventWithPublishedPhotos(app, surfaces, 3, 'defile')
  const { projector } = surfaces

  // Driven by the query hooks, so this takes a second rather than half a minute. The
  // hooks are only honoured when the server was started with E2E_HOOKS=1.
  await projector.goto(wallUrl(app, event.slug, { intervalMs: 250, transitionMs: 0 }))

  const first = await projector.getByTestId('wall-slide').first().getAttribute('data-photo-id')
  await expect
    .poll(async () => projector.getByTestId('wall-slide').first().getAttribute('data-photo-id'), {
      timeout: 5_000,
    })
    .not.toBe(first)

  // Wraps rather than stopping at the end: an eight-hour evening has more hours than
  // photos.
  await expect
    .poll(async () => projector.getByTestId('wall-slide').first().getAttribute('data-photo-id'), {
      timeout: 10_000,
    })
    .toBe(first)
})

test('a newly published photo appears without the wall jumping elsewhere', async ({
  app,
  surfaces,
}) => {
  // 1.0 kept the index in sessionStorage, so a change made two projectors disagree and
  // a refresh restarted the sequence. The cursor follows the photo, not the index.
  const event = await anEventWithPublishedPhotos(app, surfaces, 2, 'ajout')
  const { guest, host, projector } = surfaces

  // A long interval, so nothing advances on its own during the assertion.
  await projector.goto(wallUrl(app, event.slug, { intervalMs: 600_000, transitionMs: 0 }))
  const showing = await projector.getByTestId('wall-slide').first().getAttribute('data-photo-id')
  expect(showing).not.toBeNull()

  await joinAndUpload(guest, app, event.joinCode, {
    displayName: 'Tardif',
    file: await aPhoto('late', 900, 1200),
  })
  await host.reload()
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()

  // Give the wall time to refetch and rebuild, then assert it did NOT move.
  await expect
    .poll(async () => projector.getByTestId('wall-slide').first().getAttribute('data-photo-id'), {
      timeout: 8_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(showing)
})

test('the caption and the sender are legible on the slide', async ({ app, surfaces }) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'legende' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(guest, app, event.joinCode, {
    displayName: 'Léa',
    caption: 'Les confettis',
  })
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()

  await projector.goto(wallUrl(app, event.slug))
  const slide = projector.getByTestId('wall-slide').first()
  await expect(slide.getByText('Les confettis')).toBeVisible()
  await expect(slide.getByText('Léa')).toBeVisible()

  // Read from three to ten metres. The token floor is --text-xl; anything under 24px
  // computed is unreadable from the back of a room.
  const size = await slide
    .getByText('Les confettis')
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))
  expect(size).toBeGreaterThanOrEqual(24)
})

test('a guest photo is never cropped in the spotlight layout', async ({ app, surfaces }) => {
  // Cropping somebody's photo without asking is the one thing the primary layout must
  // not do. `object-fit: contain` on black is the whole rule.
  const event = await anEventWithPublishedPhotos(app, surfaces, 1, 'cadrage')
  const { projector } = surfaces

  await projector.goto(wallUrl(app, event.slug, { layout: 'spotlight' }))

  const fit = await projector
    .getByTestId('wall-slide')
    .first()
    .getByRole('img')
    .evaluate((node) => getComputedStyle(node).objectFit)
  expect(fit).toBe('contain')
})

test('the display URL picks the layout, for a projector nobody will touch', async ({
  app,
  surfaces,
}) => {
  // A kiosk autostarts one URL and is then left alone for eight hours, so `?layout=` is
  // the `L` key for that machine. Three published photos, and the wall names the layout
  // it settled on in `data-wall-layout`: a slot count alone cannot tell six layouts
  // apart — a filmstrip and a mosaic can both be holding six photos — and a silent fall
  // back between two of them shows the room photographs either way, which is how
  // `?layout=` stayed dead for four baseline generations without anybody noticing.
  const event = await anEventWithPublishedPhotos(app, surfaces, 3, 'disposition')
  const { projector } = surfaces
  const wall = projector.locator('[data-wall-layout]')

  await projector.goto(wallUrl(app, event.slug, { layout: 'mosaic' }))
  await expect(wall).toHaveAttribute('data-wall-layout', 'mosaic')
  await expect(projector.getByTestId('wall-slide')).toHaveCount(3)

  // A layout nobody implements, as a typo in a kiosk config would leave it. The room
  // gets the layout the wall response carries — never a blank screen.
  await projector.goto(wallUrl(app, event.slug, { layout: 'neon' }))
  await expect(wall).toHaveAttribute('data-wall-layout', 'spotlight')
  await expect(projector.getByTestId('wall-slide')).toHaveCount(1)

  // And the host who does walk up carries on from where the URL put the wall, rather
  // than from the start of the cycle.
  await projector.goto(wallUrl(app, event.slug, { layout: 'mosaic' }))
  await expect(wall).toHaveAttribute('data-wall-layout', 'mosaic')
  await projector.keyboard.press('l')
  await expect(wall).toHaveAttribute('data-wall-layout', 'polaroid')
})

test('the wall keeps playing when the connection drops', async ({ app, surfaces }) => {
  // Never a blank screen and never a spinner over the room's photos: the host is not
  // at the laptop, and a wall that gave up would stay given up until morning.
  const event = await anEventWithPublishedPhotos(app, surfaces, 2, 'coupure')
  const { projector } = surfaces

  await projector.goto(wallUrl(app, event.slug, { intervalMs: 300, transitionMs: 0 }))
  await expect(projector.getByTestId('wall-slide').first()).toBeVisible()

  // Kill only the stream, leaving the already-loaded photos in place.
  await projector.route('**/stream', (route) => route.abort())
  await projector.evaluate(() => {
    window.dispatchEvent(new Event('offline'))
  })

  await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
  await expect(projector.getByTestId('wall-empty')).toHaveCount(0)
})

/** The two timings the wall response carries, narrowed rather than cast to `any`. */
const wallTimings = (body: unknown): { slideIntervalMs: number; kenBurnsDurationMs: number } => {
  if (typeof body !== 'object' || body === null) throw new Error('the wall answered no object')
  const { slideIntervalMs, kenBurnsDurationMs } = body as Record<string, unknown>
  if (typeof slideIntervalMs !== 'number' || typeof kenBurnsDurationMs !== 'number') {
    throw new Error('the wall answered no timings')
  }
  return { slideIntervalMs, kenBurnsDurationMs }
}

test('the Ken Burns duration comes from the server, not a constant', async ({ app, surfaces }) => {
  // 1.0 ran a 20s zoom against a 10s slide, so every image visibly snapped back. The
  // duration is derived from the interval in `src/domain/slideshow/` and handed to the
  // client, and this is the only end-to-end guard for that (trap 6).
  //
  // It had never run. The assertion below read `--kenburns-duration`; the property the
  // wall sets is `--wall-kenburns-duration`, so the value was always the empty string
  // and the `test.skip()` that used to stand here fired on every single execution, in
  // CI included. A guard that can quietly excuse itself is not a guard, so the empty
  // string is now a failure, and the numbers are compared against the response that
  // produced them rather than against a literal typed into this file.
  const event = await anEventWithPublishedPhotos(app, surfaces, 1, 'kenburns')
  const { projector } = surfaces

  const answered = projector.waitForResponse((response) =>
    response.url().includes(`/api/events/${event.slug}/wall`),
  )
  await projector.goto(wallUrl(app, event.slug, { transitionMs: 0 }))
  const { slideIntervalMs, kenBurnsDurationMs } = wallTimings(await (await answered).json())

  const slide = projector.getByTestId('wall-slide').first()
  await expect(slide).toBeVisible()

  const duration = await slide.evaluate((node) =>
    getComputedStyle(node).getPropertyValue('--wall-kenburns-duration').trim(),
  )
  expect(duration).not.toBe('')

  const ms = duration.endsWith('ms')
    ? Number.parseFloat(duration)
    : Number.parseFloat(duration) * 1000
  // The element carries the server's number, not one the stylesheet invented.
  expect(ms).toBe(kenBurnsDurationMs)
  // And that number outlasts the slide, which is the whole of trap 6: a zoom that
  // finishes first leaves the last of every photo frozen, and one that is restarted
  // part-way is the 1.0 snap.
  expect(ms).toBeGreaterThan(slideIntervalMs)
})
