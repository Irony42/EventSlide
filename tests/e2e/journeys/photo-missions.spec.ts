import { expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { aPhoto } from '../fixtures/media'

/**
 * Photo missions, across all three surfaces (docs/ROADMAP.md §2.1).
 *
 * This is the one thing no cheaper ring can answer: **does a prompt the host typed on a
 * laptop reach a phone, come back attached to a real photograph through a real multipart
 * upload, survive a moderation decision, and change what the projector says?** Every ring
 * below this passes with any link of that chain broken — the tag is stored in a column
 * the wall reads through a query nobody else runs.
 *
 * The second test is the more important one and is the rule the whole feature rests on:
 * a photograph a guest tagged and a moderator then **refused** must not read as answered
 * on the wall. It is derived rather than stored, so nothing undoes it — and this is where
 * that claim meets a real database.
 */

/** The host's own console. Every write on the mission list is the owner's. */
const addMission = async (
  host: Parameters<typeof signInAsHost>[0],
  prompt: string,
  scope: 'guest' | 'event' = 'guest',
): Promise<void> => {
  await host.getByLabel('Consigne').fill(prompt)
  if (scope === 'event') {
    await host.getByLabel('À relever').selectOption({ label: 'Une fois pour la soirée' })
  }
  await host.getByRole('button', { name: 'Ajouter la mission' }).click()
  // The row, not a toast: the list has reloaded and the server agrees the prompt exists.
  await expect(host.getByRole('listitem').filter({ hasText: prompt })).toBeVisible()
}

/** Joins, taps a prompt, sends one photograph, and waits for the row to confirm. */
const joinAndSendForMission = async (
  guest: Parameters<typeof signInAsHost>[0],
  app: Parameters<typeof signInAsHost>[1],
  joinCode: string,
  prompt: string,
  displayName: string,
): Promise<void> => {
  await guest.goto(app.url(`/join/${joinCode}`))
  await guest.getByLabel(/Votre prénom/i).fill(displayName)
  await guest.getByRole('button', { name: /Rejoindre/i }).click()
  await guest.waitForURL(/\/e\/[^/]+\/upload/)

  await guest.getByRole('button', { name: `Choisir la mission « ${prompt} »` }).click()
  await guest
    .getByTestId('photo-input')
    .setInputFiles(await aPhoto(`mission-${displayName}`, 1200, 900))
  await guest.getByRole('button', { name: /Envoyer/i }).click()
  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')
}

const publishEverything = async (
  host: Parameters<typeof signInAsHost>[0],
  count: number,
): Promise<void> => {
  await expect(host.getByTestId('moderation-card')).toHaveCount(count)
  for (let index = 0; index < count; index += 1) {
    await host
      .getByTestId('moderation-card')
      .first()
      .getByRole('button', { name: /Publier/i })
      .click()
    // One at a time: clicking `.first()` n times only publishes n photographs if the
    // queue has actually shrunk in between.
    await expect(host.getByTestId('moderation-card')).toHaveCount(count - index - 1)
  }
}

test('a prompt the host types reaches a phone and comes back on the wall', async ({
  app,
  surfaces,
}) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'mariage-missions', name: 'Camille & Sacha' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}`))
  await addMission(host, 'un selfie avec les mariés')

  // The projector, before anybody has answered it: the prompt is on screen and open.
  await projector.goto(wallUrl(app, event.slug))
  await joinAndSendForMission(guest, app, event.joinCode, 'un selfie avec les mariés', 'Léa')

  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await publishEverything(host, 1)

  const panel = projector.getByRole('heading', { name: 'Missions' })
  await expect(panel).toBeVisible()
  // Measured rather than photographed: the visual suite owns the pixels, and a journey
  // that compared them would be testing the runner's shutter as much as the product
  // (CLAUDE.md §9 trap 10).
  const row = projector.getByRole('listitem').filter({ hasText: 'un selfie avec les mariés' })
  await expect(row).toHaveAttribute('data-mission-answered', 'true')
  await expect(row).toContainText('1 invité')
})

test('a photograph the host refuses does not answer its mission', async ({ app, surfaces }) => {
  // The hardest rule in §2.1, where it finally meets SQLite: the tag is the guest's claim
  // and publishing is the host's verdict, and the wall reads the verdict. Nothing undoes
  // the claim, because nothing ever counted it.
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'mariage-refuse', name: 'Camille & Sacha' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}`))
  await addMission(host, 'la première danse', 'event')

  await joinAndSendForMission(guest, app, event.joinCode, 'la première danse', 'Sacha')

  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await expect(host.getByTestId('moderation-card')).toHaveCount(1)
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Refuser/i })
    .click()
  await expect(host.getByTestId('moderation-card')).toHaveCount(0)

  // The wall has nothing published at all, so it is still the invitation — which is where
  // the guest's own checklist becomes the surface that can answer this. It reads the same
  // derivation the wall does.
  await guest.reload()
  const checklist = guest.getByRole('button', { name: 'Choisir la mission « la première danse »' })
  await expect(checklist).toBeVisible()
  await expect(checklist).not.toContainText('Fait')
  await expect(checklist).not.toContainText('Déjà photographiée')

  // And the projector, once something else is on it, says the same.
  await projector.goto(wallUrl(app, event.slug))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
})

test('a wall with no prompts draws no panel at all', async ({ app, surfaces }) => {
  // Which is most events. The wall that does not use this feature is exactly the wall it
  // was, and that is what keeps the committed visual baselines meaningful.
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'mariage-sans-mission', name: 'Camille & Sacha' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))

  await guest.goto(app.url(`/join/${event.joinCode}`))
  await guest.getByRole('button', { name: /Rejoindre/i }).click()
  await guest.waitForURL(/\/e\/[^/]+\/upload/)
  // The guest screen, too: no heading, no rows, nothing between the queue and the picker.
  await expect(guest.getByRole('heading', { name: 'Missions' })).toHaveCount(0)

  await guest.getByTestId('photo-input').setInputFiles(await aPhoto('no-mission', 1200, 900))
  await guest.getByRole('button', { name: /Envoyer/i }).click()
  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')

  await publishEverything(host, 1)

  await projector.goto(wallUrl(app, event.slug))
  await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
  await expect(projector.getByRole('heading', { name: 'Missions' })).toHaveCount(0)
})
