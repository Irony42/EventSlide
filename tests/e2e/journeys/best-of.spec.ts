import { expect, signInAsHost, test } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
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
