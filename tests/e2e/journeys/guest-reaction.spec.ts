import { expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A guest reacting to a photo, and the room feeling it.
 *
 * One journey, because it is the one thing no ring below can say: a tap on a phone crosses
 * the guest's device token and the double-submit CSRF header, the per-event limiter, the
 * use case, the event bus and the SSE stream, and comes out as a heart on a projector in
 * another browser. Each of those is tested alone; none of them tells you the chain closes.
 *
 * The suite is pinned to French (`suiteLocale.ts`), so the buttons are found by the words
 * the French table gives them rather than by position: a button that lost its name would
 * be a button a screen reader cannot find either.
 */

/** A reaction button's accessible name: its word, then how many people pressed it. */
const loveWith = (count: number): string =>
  fr.upload.reactionButton(fr.upload.reactionKinds.love, count)

test('a reaction a guest gives reaches the wall, outlives a reload, and can be taken back', async ({
  app,
  surfaces,
}) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'reaction', name: 'Camille & Sacha' })

  // --- Guest sends a photo; host publishes it.
  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(guest, app, event.joinCode, {
    displayName: 'Léa',
    file: await aPhoto('reaction', 1200, 900),
  })
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()

  // --- Projector: open, with the photo on it, and listening.
  //
  // The stream is awaited, not assumed: a reaction announced before the projector's stream
  // is open is not replayed to it, and a journey that raced that would fail one run in
  // twenty for a reason that is nobody's bug. The server flushes the response headers the
  // moment the connection is accepted, so the response is the moment it is listening.
  const listening = projector.waitForResponse((response) =>
    /\/api\/events\/[^/]+\/stream/u.test(response.url()),
  )
  await projector.goto(wallUrl(app, event.slug, { intervalMs: 600_000, transitionMs: 0 }))
  await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
  await listening
  await expect(projector.getByTestId('wall-reaction')).toHaveCount(0)

  // --- Guest: the list is read when the page opens, so a reload is how a guest learns
  // their photo went up. Nothing is offered under it until it has.
  await guest.reload()
  await expect(guest.getByText(fr.upload.statusPublished)).toBeVisible()
  const heart = guest.getByRole('button', { name: loveWith(0), exact: true })
  await expect(heart).toBeEnabled()
  await heart.click()

  // The thumb sees it at once; the room sees it when the server has announced it.
  await expect(guest.getByRole('button', { name: loveWith(1), exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(projector.getByTestId('wall-reaction')).toHaveCount(1)

  // --- The server holds it, not just the phone: a fresh page reads it back, pressed.
  await guest.reload()
  const given = guest.getByRole('button', { name: loveWith(1), exact: true })
  await expect(given).toBeEnabled()
  await expect(given).toHaveAttribute('aria-pressed', 'true')

  // --- Taking it back is a second tap. The request is awaited before the reload below:
  // a navigation aborts what is in flight, and the screen has already said "taken back".
  const withdrawn = guest.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      response.url().endsWith(`/reactions/love`) &&
      response.status() === 204,
  )
  await given.click()
  await withdrawn
  await expect(guest.getByRole('button', { name: loveWith(0), exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  await guest.reload()
  const gone = guest.getByRole('button', { name: loveWith(0), exact: true })
  await expect(gone).toBeEnabled()
  await expect(gone).toHaveAttribute('aria-pressed', 'false')
})
