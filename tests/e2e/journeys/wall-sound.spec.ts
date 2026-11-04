import { expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'

/**
 * Spec 12: a sound for each new photo on the wall.
 *
 * Counts `start()` on audio buffer sources in the projector's page. The host switches the sound
 * on; the wall stays silent until someone clicks on it (the browser's rule); a photo that is
 * merely sent rings nothing; the one the moderator publishes rings once.
 */
test('the wall rings for a published photo only, and only on a screen that was activated', async ({
  app,
  surfaces,
}) => {
  const { host, guest, projector } = surfaces
  await projector.addInitScript(() => {
    const w = window as unknown as { __starts: number }
    w.__starts = 0
    const original = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args) {
      w.__starts += 1
      return original.apply(this, args)
    }
  })
  const starts = () =>
    projector.evaluate(() => (window as unknown as { __starts: number }).__starts)

  const event = await app.seedEvent({ slug: 'sonnerie', name: 'Camille & Sacha' })
  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/settings`))
  await host.getByRole('checkbox', { name: 'Un son à chaque nouvelle photo' }).check()
  await host.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(host.getByText('Réglages enregistrés.')).toBeVisible()

  await projector.goto(wallUrl(app, event.slug))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  const activate = projector.getByRole('button', { name: 'Activer le son sur cet écran' })
  await projector.mouse.move(40, 40)
  await expect(activate).toBeVisible()
  expect(await starts()).toBe(0)

  // The click is the gesture: the screen is allowed, and a test sound retentit once.
  await activate.click()
  await expect(activate).toHaveCount(0)
  await expect.poll(starts).toBe(1)

  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  // The upload announces itself on the event stream; the wall reads again, and that read is the
  // moment to look: it is what would have rung had it counted a waiting photo.
  const reread = projector.waitForResponse((response) =>
    response.url().includes(`/api/events/${event.slug}/wall`),
  )
  await joinAndUpload(guest, app, event.joinCode, {
    displayName: 'Invité',
    caption: 'Première',
    file: await aPhoto('sonnerie-1', 1200, 900),
  })
  await expect(host.getByTestId('moderation-card')).toHaveCount(1)
  // Sent, not published: no sound, so the room cannot learn that a photo is waiting.
  await reread
  expect(await starts()).toBe(1)

  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()
  await expect.poll(starts).toBe(2)
})
