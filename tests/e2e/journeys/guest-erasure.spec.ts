import { csrfHeaders, expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A guest taking back everything they sent (roadmap §5.2), and the room, the host and the
 * server agreeing that it is gone.
 *
 * One journey, because only the real chain closes it: a button on a phone, the device token
 * and the CSRF header, the use case deleting files and rows, the bus, the SSE stream and a
 * projector in another browser dropping the slide without a reload. The rules (what goes,
 * what is ignored, tenant isolation) are tested one ring down; this says they are wired.
 *
 * The photograph is **published** and the host's self-delete setting is left at its default:
 * the grace-window deletion would refuse this, which is the point of the feature.
 */
test('a guest deletes everything they sent: the wall and the host lose it at once, and the files are gone', async ({
  app,
  surfaces,
}) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'effacement', name: 'Camille & Sacha' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(guest, app, event.joinCode, {
    displayName: 'Léa',
    file: await aPhoto('erasure', 1200, 900),
  })
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()

  const listening = projector.waitForResponse((response) =>
    /\/api\/events\/[^/]+\/stream/u.test(response.url()),
  )
  await projector.goto(wallUrl(app, event.slug, { intervalMs: 600_000, transitionMs: 0 }))
  await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
  await listening

  const mine = await guest.request.get(app.url(`/api/events/${event.slug}/photos/mine`))
  const photoId = (await mine.json()).items[0].id as string
  const display = app.url(`/api/events/${event.slug}/photos/${photoId}/display`)
  // The host's own session reads it: the guest's cookie is about to go, the host's is not.
  expect((await host.request.get(display)).status()).toBe(200)

  // --- Two taps, and the second one is a different, labelled button.
  await guest.getByRole('button', { name: fr.upload.eraseOpen }).click()
  const dialog = guest.getByRole('dialog', { name: fr.upload.eraseTitle })
  await expect(dialog).toContainText(fr.upload.eraseBody)
  await dialog.getByRole('button', { name: fr.upload.eraseConfirm }).click()

  await expect(guest.getByRole('heading', { name: fr.upload.eraseDoneTitle })).toBeVisible()

  // --- The room drops it by itself, and so does the host's queue.
  await expect(projector.getByTestId('wall-slide')).toHaveCount(0)
  await host.reload()
  await expect(host.getByTestId('moderation-card')).toHaveCount(0)

  // --- The bytes are gone, not only the row, and the device is a stranger again.
  expect((await host.request.get(display)).status()).toBe(404)
  const again = await guest.request.get(app.url(`/api/events/${event.slug}/photos/mine`))
  expect(again.status()).toBe(401)
})

test('a guest the host removed can still erase everything they sent, from their own phone', async ({
  app,
  surfaces,
}) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'effacement-retire', name: 'Camille & Sacha' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(guest, app, event.joinCode, {
    displayName: 'Léa',
    file: await aPhoto('erasure-revoked', 1200, 900),
  })
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()

  const listening = projector.waitForResponse((response) =>
    /\/api\/events\/[^/]+\/stream/u.test(response.url()),
  )
  await projector.goto(wallUrl(app, event.slug, { intervalMs: 600_000, transitionMs: 0 }))
  await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
  await listening

  // --- The host removes the guest. Their token is now refused everywhere but the erasure.
  const guests = await host.request.get(app.url(`/api/events/${event.slug}/guests`))
  const guestId = (await guests.json()).items[0].id as string
  const revoked = await host.request.post(
    app.url(`/api/events/${event.slug}/guests/${guestId}/revoke`),
    { headers: await csrfHeaders(host.request, app) },
  )
  expect(revoked.status()).toBe(204)
  expect((await guest.request.get(app.url(`/api/events/${event.slug}/photos/mine`))).status()).toBe(
    403,
  )

  // --- Their phone says so in plain words and still offers the one action.
  await guest.reload()
  await expect(guest.getByText(fr.upload.revokedTitle)).toBeVisible()
  await guest.getByRole('button', { name: fr.upload.eraseOpen }).click()
  await guest
    .getByRole('dialog', { name: fr.upload.eraseTitle })
    .getByRole('button', { name: fr.upload.eraseConfirm })
    .click()
  await expect(guest.getByRole('heading', { name: fr.upload.eraseDoneTitle })).toBeVisible()

  // --- The room and the host's queue lose it.
  await expect(projector.getByTestId('wall-slide')).toHaveCount(0)
  await host.reload()
  await expect(host.getByTestId('moderation-card')).toHaveCount(0)
})
