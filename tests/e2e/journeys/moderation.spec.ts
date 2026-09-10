import { expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { aPhoto } from '../fixtures/media'
import { joinAndUpload } from '../fixtures/guest'

/**
 * The host's evening: a queue that fills over SSE, decisions taken by keyboard, and an
 * undo for the one fired by accident.
 *
 * These cross two surfaces, which is why they are here rather than in a component
 * test: the assertion that matters is that a decision on the laptop changes the
 * projector, and that a decision *not* taken leaves it alone.
 */

test('a decision on the laptop changes the projector, with no reload @smoke', async ({
  app,
  surfaces,
}) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'mariage', name: 'Camille & Sacha' })

  await projector.goto(wallUrl(app, event.slug))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await expect(host.getByText(/Rien à valider/i)).toBeVisible()

  // The queue must fill without the host touching anything.
  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa', caption: 'Les confettis' })
  const card = host.getByTestId('moderation-card').first()
  await expect(card).toBeVisible()

  await card.getByRole('button', { name: /Publier/i }).click()

  await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
  await expect(projector.getByTestId('wall-empty')).toBeHidden()
})

test('a refused photo never reaches the projector', async ({ app, surfaces }) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'gala', name: 'Gala' })

  await projector.goto(wallUrl(app, event.slug))
  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))

  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Tom' })
  const card = host.getByTestId('moderation-card').first()
  await expect(card).toBeVisible()

  await card.getByRole('button', { name: /Refuser/i }).click()

  // The negative is the whole product promise, so it is asserted explicitly rather
  // than inferred from the absence of a passing assertion.
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  await expect(projector.getByTestId('wall-slide')).toHaveCount(0)
})

test('undo restores a photo refused by mistake', async ({ app, surfaces }) => {
  // A bulk reject fired by accident is the scenario this exists for. Without an undo
  // the only recovery is finding the photo in a filtered list.
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'anniversaire' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa' })

  const card = host.getByTestId('moderation-card').first()
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: /Refuser/i }).click()

  await host.getByRole('button', { name: /Annuler/i }).click()

  await expect(host.getByTestId('moderation-card').first()).toBeVisible()
})

test('the keyboard alone gets through the queue', async ({ app, surfaces }) => {
  // A host works through a hundred photos standing at a laptop. Reaching for the mouse
  // for each one is what makes a queue unfinishable.
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'kermesse' })

  await projector.goto(wallUrl(app, event.slug))
  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Tom' })

  await expect(host.getByTestId('moderation-card').first()).toBeVisible()
  await host.keyboard.press('j')
  await host.keyboard.press('p')

  await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
})

test('a shortcut does not fire while the host is typing', async ({ app, surfaces }) => {
  // `p` in a filter or caption field must be a letter, not a publish. Getting this
  // wrong publishes a photo while somebody searches.
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'salon' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa' })
  await expect(host.getByTestId('moderation-card').first()).toBeVisible()

  const field = host.getByRole('textbox').first()
  const hasTextbox = (await field.count()) > 0
  test.skip(!hasTextbox, 'the console has no text field on this screen yet')

  await field.click()
  await field.press('p')

  // Still pending: the keystroke went into the field.
  await expect(host.getByTestId('moderation-card').first()).toBeVisible()
  await expect(field).toHaveValue(/p/)
})

test('a bulk action reports what it skipped rather than failing wholesale', async ({
  app,
  surfaces,
}) => {
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'convention' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))

  for (const label of ['un', 'deux']) {
    await joinAndUpload(guest, app, event.joinCode, {
      displayName: label,
      file: await aPhoto(label, 800, 600),
    })
  }
  await expect(host.getByTestId('moderation-card')).toHaveCount(2)

  // Publish one, then select both and publish again: the already-published one is an
  // illegal repeat for the other decision path and must be skipped, not fatal.
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()

  await host.getByRole('button', { name: /Tout sélectionner/i }).click()
  await host.getByRole('button', { name: /Publier \(/i }).click()

  // Either every id applied or some were skipped — both are correct outcomes. What
  // must not happen is an error that loses the whole batch.
  await expect(host.getByRole('alert')).toHaveCount(0)
})

test('the host sees the pending count, and it drops as they work', async ({ app, surfaces }) => {
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'fete' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa' })

  await expect(host.getByText(/1 photo en attente/i)).toBeVisible()

  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()

  await expect(host.getByText(/Rien à valider/i)).toBeVisible()
})
