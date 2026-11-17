import { expect, csrfHeaders, joinAsGuest, signInAsHost, test } from '../fixtures/app'
import { passPrivacyNotice } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * Spec 23, the guest's phone: a roll of two poses on a disposable-camera evening, a third photograph
 * that has nowhere to go, veiled thumbnails that take their colours when the host reveals, and a
 * feed that says when the photos open.
 *
 * Real time and real requests: the reveal is by hand (no hour), so the phone finds out the way it
 * does in a room, by asking again while its guest looks. Nothing here waits on a timer of its own.
 */

test('a guest uses a roll of two poses, sees veiled photographs, and finds them developed at the reveal', async ({
  app,
  surfaces,
}) => {
  const { host, guest } = surfaces
  const event = await app.seedEvent({ slug: 'jetable-invite', name: 'Camille & Sacha' })
  await signInAsHost(host, app)
  const headers = await csrfHeaders(host.request, app)
  const saved = await host.request.patch(app.url(`/api/events/${event.slug}/settings`), {
    headers,
    data: { moderation: 'auto', maxPhotosPerGuest: 2, reveal: { enabled: true, film: true } },
  })
  expect(saved.ok()).toBe(true)

  await joinAsGuest(guest, app, event.joinCode, 'Invité')
  await passPrivacyNotice(guest)

  // The roll starts fresh, the hour is the host's to give, and the one button opens the camera.
  await expect(guest.getByTestId('guest-poses')).toHaveText(fr.reveal.freshRoll(2))
  await expect(guest.getByTestId('guest-reveal')).toHaveText(fr.reveal.guestManual)
  await expect(guest.getByTestId('photo-input')).toHaveAttribute('capture', 'environment')

  // Two photographs on two poses.
  await guest
    .getByTestId('photo-input')
    .setInputFiles([await aPhoto('pose-un', 1200, 900), await aPhoto('pose-deux', 1200, 900)])
  await guest.getByRole('button', { name: /Envoyer/i }).click()
  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')
  await expect(guest.getByTestId('upload-item-1')).toHaveAttribute('data-state', 'done')

  // The roll is used up: no picker, in words, and what was sent stays listed.
  await expect(guest.getByText(fr.reveal.rollEmpty)).toBeVisible()
  await expect(guest.getByTestId('photo-input')).toHaveCount(0)
  const mine = guest.getByRole('list').filter({ has: guest.getByRole('img') })
  await expect(mine.getByRole('listitem')).toHaveCount(2)

  // Veiled, and said in words: published for the host, not yet developed for the room.
  await expect(mine.getByText(fr.reveal.undeveloped)).toHaveCount(2)
  const thumb = mine.getByRole('img').first()
  await expect(thumb).toHaveCSS('filter', /grayscale\(1\)/)

  // The feed does not say "nothing yet": it says when.
  await guest.goto(app.url(`/e/${event.slug}/photos`))
  await expect(guest.getByTestId('feed-reveal')).toBeVisible()
  await expect(guest.getByTestId('feed-reveal')).toContainText(fr.reveal.feedSoon)
  await expect(guest.locator('img[src*="/photos/"]')).toHaveCount(0)
  await guest.goBack()

  // No sideways scroll on a phone, with all of this on screen.
  const overflow = await guest.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  // The host reveals. No signal reaches the phone: it asks again by itself, and develops.
  const revealed = await host.request.post(app.url(`/api/events/${event.slug}/reveal`), { headers })
  expect(revealed.ok()).toBe(true)

  await expect(guest.getByText(fr.reveal.developedNow(2))).toBeVisible({ timeout: 30_000 })
  await expect(mine.getByText(fr.reveal.undeveloped)).toHaveCount(0)
  await expect(guest.getByTestId('guest-reveal')).toHaveCount(0)
  // Developed: the veil's grayscale(1) is gone (the film look keeps a grayscale(0) to fade from).
  await expect(thumb).not.toHaveCSS('filter', /grayscale\(1\)/)
})
