import { expect, test, wallUrl } from '../fixtures/app'
import { jpegWithOrientation, theSamePhotoTwice } from '../fixtures/media'

/**
 * The journey the whole product exists for: a photo taken on a phone reaching the
 * projector, and not reaching it before the host says so.
 *
 * This crosses three browser contexts, a real multipart upload, `sharp`, SQLite, a
 * moderation decision and an SSE frame. Every ring below it passes with this path
 * broken — which is exactly what happened in 1.0, where the QR page emitted
 * `?partyname=` and the upload page read `?party`, so every guest silently uploaded to
 * the default event and nothing caught it.
 */

test('a photo from a phone reaches the wall once the host approves it @smoke', async ({
  app,
  surfaces,
}) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'mariage', name: 'Camille & Sacha' })

  // --- The room: the wall is already running before anyone arrives.
  await projector.goto(wallUrl(app, event.slug))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  // Someone arriving late must be able to join from what is on the screen.
  await expect(projector.getByText(event.joinCode)).toBeVisible()

  // --- The phone: scans the QR code, lands on the join page, no account.
  await guest.goto(app.url(`/join/${event.joinCode}`))
  await guest.getByLabel(/Votre prénom/i).fill('Léa')
  await guest.getByRole('button', { name: /Rejoindre/i }).click()
  await expect(guest.getByRole('heading', { name: /Camille & Sacha/ })).toBeVisible()

  // Orientation 6: the stored pixels are landscape, the correct rendering is portrait.
  await guest.getByTestId('photo-input').setInputFiles(await jpegWithOrientation(6))
  await guest.getByLabel(/Légende/i).fill('Les confettis')
  await guest.getByRole('button', { name: /Envoyer/i }).click()
  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')

  // --- The room, still: nothing has appeared. This is the product's core promise, and
  // a journey that only asserted the happy ending would pass with moderation bypassed.
  await expect(projector.getByTestId('wall-empty')).toBeVisible()

  // --- The laptop: the photo arrives in the queue over SSE, with no reload.
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  const card = host.getByTestId('moderation-card').first()
  await expect(card).toBeVisible()
  await expect(card.getByText('Les confettis')).toBeVisible()
  await expect(card.getByText('Léa')).toBeVisible()
  await card.getByRole('button', { name: /Publier/i }).click()

  // --- The room: it appears, over SSE, with no reload.
  const slide = projector.getByTestId('wall-slide').first()
  await expect(slide).toBeVisible()
  await expect(slide.getByText('Les confettis')).toBeVisible()
  await expect(slide.getByText('Léa')).toBeVisible()

  // Upright. If `sharp(...).rotate()` were ever dropped from ingest, the stored image
  // would stay landscape and this is the only ring that would notice — 1.0 projected
  // every phone portrait on its side for exactly this reason.
  const box = await slide.getByRole('img').boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThan(box!.width)
})

test('a guest sees their own photo waiting, rather than wondering whether it sent', async ({
  app,
  surfaces,
}) => {
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'anniversaire', name: 'Les 40 ans de Sam' })

  await guest.goto(app.url(`/join/${event.joinCode}`))
  await guest.getByRole('button', { name: /Rejoindre/i }).click()
  await guest.getByTestId('photo-input').setInputFiles(await jpegWithOrientation(1))
  await guest.getByRole('button', { name: /Envoyer/i }).click()
  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')

  // Silence after an upload is indistinguishable from a failure, and a guest who
  // cannot tell will send the photo again.
  await expect(guest.getByText(/En attente de validation/i)).toBeVisible()
})

test('an anonymous guest can send a photo without giving a name', async ({ app, surfaces }) => {
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'gala', name: 'Gala annuel' })

  await guest.goto(app.url(`/join/${event.joinCode}`))
  // The name field is left untouched on purpose: anonymity is a supported choice, not
  // a validation failure.
  await guest.getByRole('button', { name: /Rejoindre/i }).click()

  await guest.getByTestId('photo-input').setInputFiles(await jpegWithOrientation(1))
  await guest.getByRole('button', { name: /Envoyer/i }).click()

  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')
})

test('the same photo sent twice is reported as already sent, not duplicated', async ({
  app,
  surfaces,
}) => {
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'mariage-bis', name: 'Noces' })
  const [first, second] = await theSamePhotoTwice()

  await guest.goto(app.url(`/join/${event.joinCode}`))
  await guest.getByRole('button', { name: /Rejoindre/i }).click()

  await guest.getByTestId('photo-input').setInputFiles(first)
  await guest.getByRole('button', { name: /Envoyer/i }).click()
  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')

  // A double-tapped submit, or a retry after the connection dropped, must not put the
  // same photo on the wall twice — and must read as reassurance rather than an error.
  await guest.getByTestId('photo-input').setInputFiles(second)
  await guest.getByRole('button', { name: /Envoyer/i }).click()
  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'duplicate')
  await expect(guest.getByText(/Déjà envoyée/i)).toBeVisible()
})

test('a join code typed with the wrong case and a stray dash still works', async ({
  app,
  surfaces,
}) => {
  // The tolerance exists for a guest reading a printed card in a dark room. Without it
  // the most common failure at an event is a guest giving up on the code.
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'kermesse', name: 'Kermesse' })
  const mistyped = `${event.joinCode.slice(0, 3).toLowerCase()}-${event.joinCode.slice(3)}`

  await guest.goto(app.url('/join'))
  await guest.getByLabel(/Code de la soirée/i).fill(mistyped)
  await guest.getByRole('button', { name: /Rejoindre/i }).click()

  await expect(guest.getByRole('heading', { name: /Kermesse/ })).toBeVisible()
})

test('an unknown code says so and lets the guest correct it', async ({ app, surfaces }) => {
  const { guest } = surfaces

  await guest.goto(app.url('/join'))
  await guest.getByLabel(/Code de la soirée/i).fill('ZZZZZZ')
  await guest.getByRole('button', { name: /Rejoindre/i }).click()

  await expect(guest.getByRole('alert')).toBeVisible()
  // The field keeps its value and stays editable: blaming a guest for a typo and then
  // clearing what they typed is how they stop trying.
  await expect(guest.getByLabel(/Code de la soirée/i)).toBeEditable()
})
