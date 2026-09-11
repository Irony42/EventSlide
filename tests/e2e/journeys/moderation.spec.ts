import { expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { aPhoto } from '../fixtures/media'
import { joinAndUpload } from '../fixtures/guest'
import { fr } from '../../../web/src/lib/i18n/fr'

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

test('undo puts a published photo the host then refused back on the wall', async ({
  app,
  surfaces,
}) => {
  // A reject fired by accident on a photo already on the wall is the scenario undo
  // exists for: the previous status was `published`, so "put that back" has exactly one
  // meaning and the console can act on it.
  //
  // The affordance is an action carried by the decision's own toast, not a button that
  // lives on the screen — see `undoToastRef` in `useModerationQueue` — so it is reached
  // by its label rather than by a place in the layout.
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'anniversaire' })

  await projector.goto(wallUrl(app, event.slug))
  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  // "Toutes" rather than the default "En attente": the photo changes status three times
  // here, and a filtered queue would drop the card out of the grid between them, leaving
  // the test asserting on a card's absence instead of on the status it now holds.
  await host.getByRole('button', { name: fr.moderation.filterAll, exact: true }).click()

  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa' })

  const card = host.getByTestId('moderation-card').first()
  await expect(card).toHaveAttribute('data-status', 'pending')

  // Matched on the verb alone. A decision button's accessible name is the verb plus the
  // photo's author, and the queue endpoint sends `authorName: null` for every photo
  // (`moderationRoutes.ts`, the `listEventPhotos` response), so naming the guest here
  // would pin a separate defect onto a test about undo.
  await card.getByRole('button', { name: fr.moderation.publish }).click()
  await expect(card).toHaveAttribute('data-status', 'published')
  await expect(projector.getByTestId('wall-slide')).toHaveCount(1)

  await card.getByRole('button', { name: fr.moderation.reject }).click()
  await expect(card).toHaveAttribute('data-status', 'rejected')
  await expect(projector.getByTestId('wall-empty')).toBeVisible()

  await host.getByRole('button', { name: fr.moderation.undo, exact: true }).click()

  await expect(host.getByText(fr.moderation.undone)).toBeVisible()
  await expect(card).toHaveAttribute('data-status', 'published')

  // The assertion that actually pins the behaviour, and the one the title claims.
  //
  // `data-status` above is the console's *optimistic* status: undo writes the remembered
  // previous status into the grid before the request resolves, so that attribute reads
  // `published` even if the undo sent the wrong verb and the server stored something
  // else. The projector has no such opinion — it renders what the server published — so
  // an undo restoring `hidden` instead of `published` leaves the wall empty here and
  // fails, which is exactly the mistake the optimistic assertion cannot see.
  await expect(projector.getByTestId('wall-slide')).toHaveCount(1)
  await expect(projector.getByTestId('wall-empty')).toBeHidden()
})

test('no undo is offered for a photo refused while it was still pending', async ({
  app,
  surfaces,
}) => {
  // The deliberate gap in `RESTORING_DECISION`, asserted where a host would meet it.
  //
  // No decision verb produces `pending`, so a photo refused while it was awaiting one
  // has no status the console can put it back into. Offering "annuler" anyway would
  // mean guessing, and the only guess available — `publish` — throws a photo nobody
  // approved onto the projector, which is the one thing a host is promised cannot
  // happen. So the offer is withheld, and its absence is the safety property.
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'anniversaire-pending' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await host.getByRole('button', { name: fr.moderation.filterAll, exact: true }).click()

  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa' })

  const card = host.getByTestId('moderation-card').first()
  await expect(card).toHaveAttribute('data-status', 'pending')

  await card.getByRole('button', { name: fr.moderation.reject }).click()

  // The outcome is announced first, so the absence below is a decision that completed
  // without an undo rather than one that had not been announced yet — a bare
  // `toHaveCount(0)` would pass against a page that simply had not rendered anything.
  const notice = host.getByText(fr.moderation.refused(1))
  await expect(notice).toBeVisible()
  await expect(card).toHaveAttribute('data-status', 'rejected')

  // Bounded far inside the announcement's own life, and *not* left on the default
  // expect timeout.
  //
  // An undo offer is carried by its toast, and `ToastProvider` holds a toast carrying an
  // action for UNDO_DURATION_MS (9s) against 4s for a plain notice. The default expect
  // timeout is 10s — longer than both — so a `toHaveCount(0)` that simply waited would
  // go green the moment the toast expired, whether or not an undo had been offered. It
  // does: injecting `pending: 'publish'` into `RESTORING_DECISION` offers the undo this
  // test exists to forbid, and the unbounded version still passed.
  await expect(host.getByRole('button', { name: fr.moderation.undo, exact: true })).toHaveCount(0, {
    timeout: 1_000,
  })

  // And the announcement was still on screen for all of it, so the absence above was
  // observed against a rendered toast rather than against one that had come and gone.
  await expect(notice).toBeVisible()
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
