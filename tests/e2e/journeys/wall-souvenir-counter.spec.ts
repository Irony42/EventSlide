import { expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'

/**
 * Spec 11: the souvenir counter on the wall.
 *
 * One journey across the surfaces: the host switches the counter on, a guest sends a photo to a
 * moderated event (the wall must not move), a moderator publishes it (the counter goes up on the
 * projector that is already running, with no reload), and the counter stays out of the way.
 */
test('the counter counts what is published, never what is merely sent', async ({
  app,
  surfaces,
}) => {
  const { host, guest, projector } = surfaces
  const event = await app.seedEvent({ slug: 'souvenirs', name: 'Camille & Sacha' })
  await signInAsHost(host, app)

  await host.goto(app.url(`/admin/events/${event.slug}/settings`))
  await host.getByRole('checkbox', { name: 'Afficher le compteur de souvenirs' }).check()
  await host.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(host.getByText('Réglages enregistrés.')).toBeVisible()

  await projector.goto(wallUrl(app, event.slug))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  await expect(projector.getByTestId('souvenir-counter')).toHaveCount(0)

  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(guest, app, event.joinCode, {
    displayName: 'Invité',
    caption: 'Première',
    file: await aPhoto('souvenir-1', 1200, 900),
  })
  await expect(host.getByTestId('moderation-card')).toHaveCount(1)

  // Sent, not published: the room learns nothing.
  await expect(projector.getByTestId('souvenir-counter')).toHaveCount(0)

  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()

  const counter = projector.getByTestId('souvenir-counter')
  await expect(counter).toHaveText('1 souvenir partagé')

  // Geometry, not pixels: top centre, clear of the missions' corner and the notices' corner.
  const box = await counter.boundingBox()
  const viewport = projector.viewportSize()
  if (box === null || viewport === null) throw new Error('no box to measure')
  expect(box.y).toBeLessThan(viewport.height / 4)
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2)
})
