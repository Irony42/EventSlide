import { expect, signInAsHost, test } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aPhoto, hasEncoder } from '../fixtures/media'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host's best-of, step 1 (spec 08): star a published photo in the console, see the count
 * on the event page, take the favourites home as a ZIP, and lose the star when the photo
 * leaves the wall.
 *
 * It crosses a guest's phone and the host's laptop, and the ZIP is a real stream over real
 * media, which a component test cannot say.
 */

test('a host stars a photo, downloads the favourites as a ZIP, and loses the star when hiding it', async ({
  app,
  surfaces,
}) => {
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'mariage', name: 'Camille & Sacha' })
  await signInAsHost(host, app)

  await host.goto(app.url(`/admin/events/${event.slug}`))
  await expect(host.getByText(fr.admin.bestOfNone)).toBeVisible()
  await expect(host.getByRole('button', { name: fr.admin.bestOfDownload })).toBeDisabled()
  // Nothing is starred: the archive is refused before any header is sent.
  expect((await host.request.get(app.url(`/api/events/${event.slug}/best-of.zip`))).status()).toBe(
    409,
  )

  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa' })
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  const card = host.getByTestId('moderation-card').first()
  await card.getByRole('button', { name: /Publier/i }).click()
  await host.getByRole('button', { name: fr.moderation.filterPublished }).click()

  const star = host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: fr.moderation.highlight })
  await expect(star).toHaveAttribute('aria-pressed', 'false')
  await star.click()
  await expect(star).toHaveAttribute('aria-pressed', 'true')

  await host.goto(app.url(`/admin/events/${event.slug}`))
  await expect(host.getByText(fr.admin.bestOfCount(1))).toBeVisible()
  const archive = await host.request.get(app.url(`/api/events/${event.slug}/best-of.zip`))
  expect(archive.status()).toBe(200)
  expect(archive.headers()['content-disposition']).toBe(
    `attachment; filename="${event.slug}-best-of.zip"`,
  )
  expect((await archive.body()).subarray(0, 2).toString('latin1')).toBe('PK')

  // Taking the photo off the wall takes the star with it.
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await host.getByRole('button', { name: fr.moderation.filterPublished }).click()
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Retirer de l.écran/i })
    .click()
  await host.goto(app.url(`/admin/events/${event.slug}`))
  await expect(host.getByText(fr.admin.bestOfNone)).toBeVisible()
})

/**
 * Step 2 (spec 08): the highlight video. Three published favourites are montaged by the real
 * worker with the real encoder, the host plays it, and taking one photo off the wall makes the
 * file stop being served at once (the route re-checks the photographs on every request).
 */
test('a host makes the highlight video from three favourites, and loses it when one leaves the wall', async ({
  app,
  surfaces,
}) => {
  test.skip(!hasEncoder(), 'no ffmpeg on this machine: the montage cannot be rendered')
  test.setTimeout(180_000)
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'mariage-video', name: 'Camille & Sacha' })
  await signInAsHost(host, app)

  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa' })
  for (const width of [1100, 1000]) {
    await guest.reload()
    await guest.getByTestId('photo-input').setInputFiles(await aPhoto('journey', width, 800))
    await guest.getByRole('button', { name: /Envoyer/i }).click()
    await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')
  }

  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  for (let left = 3; left > 0; left -= 1) {
    await host
      .getByTestId('moderation-card')
      .first()
      .getByRole('button', { name: /Publier/i })
      .click()
    await expect(host.getByTestId('moderation-card')).toHaveCount(left - 1)
  }
  await host.getByRole('button', { name: fr.moderation.filterPublished }).click()
  await expect(host.getByTestId('moderation-card')).toHaveCount(3)
  for (let index = 0; index < 3; index += 1) {
    const star = host
      .getByTestId('moderation-card')
      .nth(index)
      .getByRole('button', { name: fr.moderation.highlight })
    await star.click()
    await expect(star).toHaveAttribute('aria-pressed', 'true')
  }

  await host.goto(app.url(`/admin/events/${event.slug}`))
  await host.getByRole('button', { name: fr.admin.reelCreate }).click()
  await expect(host.getByText(fr.admin.reelReady(3))).toBeVisible({ timeout: 120_000 })

  const file = await host.request.get(app.url(`/api/events/${event.slug}/highlights/reel.mp4`))
  expect(file.status()).toBe(200)
  expect(file.headers()['content-type']).toBe('video/mp4')
  expect(file.headers()['cache-control']).toBe('private, no-store')
  // An ISO base media file: "ftyp" at byte 4.
  expect((await file.body()).subarray(4, 8).toString('latin1')).toBe('ftyp')
  await expect(host.locator('video')).toBeVisible()

  // One photo leaves the wall: the file is no longer served, whatever the worker has done yet.
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await host.getByRole('button', { name: fr.moderation.filterPublished }).click()
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Retirer de l.écran/i })
    .click()
  const gone = await host.request.get(app.url(`/api/events/${event.slug}/highlights/reel.mp4`))
  expect(gone.status()).toBe(404)
})
