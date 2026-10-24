import {
  closeQuietly,
  csrfHeaders,
  expect,
  joinAsGuest,
  signInAsHost,
  test,
  wallUrl,
} from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A guest reacting to somebody else's photo, and the room feeling it.
 *
 * One journey, because it is the one thing no ring below can say: a tap on a phone crosses
 * the guest's device token and the double-submit CSRF header, the per-event limiter, the
 * use case, the event bus and the SSE stream, and comes out as a heart on a projector in
 * another browser. Each of those is tested alone; none of them tells you the chain closes.
 *
 * Two guests, because a guest does not react to their own photograph: one sends, the other
 * reads "Les photos de la soirée" and reacts, and the sender's own copy of the page offers
 * them nothing under their own photo.
 *
 * The suite is pinned to French (`suiteLocale.ts`), so the buttons are found by the words
 * the French table gives them rather than by position: a button that lost its name would
 * be a button a screen reader cannot find either.
 */

type Kind = keyof typeof fr.upload.reactionKinds

/** A reaction button, by the word a screen reader says for it. */
const named = (kind: Kind): { name: string; exact: true } => ({
  name: fr.upload.reactionKinds[kind],
  exact: true,
})

test('a guest reacts to another guest’s photo: the wall shows it, a reload keeps it, a second tap takes it back', async ({
  app,
  surfaces,
  browser,
}) => {
  const { guest: author, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'reaction', name: 'Camille & Sacha' })

  // --- One guest sends a photo; the host publishes it.
  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(author, app, event.joinCode, {
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

  // --- A second guest, on a phone of their own, opens the photographs of the evening.
  const readerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    baseURL: app.baseUrl,
    locale: SUITE_LOCALE,
  })
  try {
    const reader = await readerContext.newPage()
    await joinAsGuest(reader, app, event.joinCode, 'Sacha')
    await reader.getByRole('link', { name: fr.feed.link }).click()
    await expect(reader.getByRole('heading', { level: 1, name: fr.feed.title })).toBeVisible()
    await expect(reader.getByRole('img')).toBeVisible()

    const heart = reader.getByRole('button', named('love'))
    await expect(heart).toBeEnabled()

    // The five sit on one line on a phone, whatever has been pressed: a button that drops to
    // a second row as the others fill is one that moves under the thumb that was about to
    // use it.
    const kinds: readonly Kind[] = ['love', 'laugh', 'wow', 'cheers', 'clap']
    const tops = await Promise.all(
      kinds.map(async (kind) => (await reader.getByRole('button', named(kind)).boundingBox())?.y),
    )
    expect(tops).not.toContain(undefined)
    expect(new Set(tops).size).toBe(1)

    await heart.click()

    // The thumb sees it at once; the room sees it when the server has announced it.
    await expect(heart).toHaveAttribute('aria-pressed', 'true')
    await expect(projector.getByTestId('wall-reaction')).toHaveCount(1)

    // --- The server holds it, not just the phone: a fresh page reads it back, pressed.
    await reader.reload()
    const given = reader.getByRole('button', named('love'))
    await expect(given).toBeEnabled()
    await expect(given).toHaveAttribute('aria-pressed', 'true')

    // --- Taking it back is a second tap. The request is awaited before the reload below:
    // a navigation aborts what is in flight, and the screen has already said "taken back".
    const withdrawn = reader.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        response.url().endsWith('/reactions/love') &&
        response.status() === 204,
    )
    await given.click()
    await withdrawn
    await expect(given).toHaveAttribute('aria-pressed', 'false')

    await reader.reload()
    const gone = reader.getByRole('button', named('love'))
    await expect(gone).toBeEnabled()
    await expect(gone).toHaveAttribute('aria-pressed', 'false')
  } finally {
    await closeQuietly(readerContext)
  }

  // --- The author, on the same page, is offered nothing under their own photograph: the
  // room's favourite is not one the author can vote for.
  await author.goto(app.url(`/e/${event.slug}/photos`))
  await expect(author.getByRole('img')).toBeVisible()
  await expect(author.getByText(fr.feed.own, { exact: true })).toBeVisible()
  await expect(author.getByRole('group')).toHaveCount(0)

  // And the server is what refuses, not the page: asked directly, with the author's own
  // token, it answers 403 and the projector gets no heart.
  const ownPhotoId = (await author.getByRole('img').getAttribute('src'))?.split('/').at(-2)
  expect(ownPhotoId).toBeDefined()
  const refused = await author.request.post(
    app.url(`/api/events/${event.slug}/photos/${ownPhotoId}/reactions`),
    { data: { kind: 'love' }, headers: await csrfHeaders(author.request, app) },
  )
  expect(refused.status()).toBe(403)
  expect(await refused.json()).toMatchObject({ error: { code: 'reaction.ownPhoto' } })
  // The one heart the other guest's tap floated, and no second one.
  await expect(projector.getByTestId('wall-reaction')).toHaveCount(1)
})
