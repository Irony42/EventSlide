import { expect, test } from '../fixtures/app'
import { aPhoto } from '../fixtures/media'
import type { Page } from '@playwright/test'

/**
 * The one journey no cheaper ring can answer: does a photo picked on a dead venue Wi-Fi
 * actually reach the projector once the network comes back?
 *
 * That path crosses a real service-worker registration, a real IndexedDB, a real
 * multipart upload, `sharp`, SQLite, a moderation decision and an SSE frame to a second
 * browser context. Every ring below this one passes with the whole thing broken,
 * because every ring below it fakes the network.
 *
 * The network is cut with `context.setOffline`, which is the closest a test gets to a
 * saturated access point: requests fail at the transport, exactly as they do at 21:30
 * at a wedding. Nothing here stubs a route.
 */

const sendOne = async (guest: Page, file: string): Promise<void> => {
  await guest.getByTestId('photo-input').setInputFiles(file)
  await guest.getByRole('button', { name: /Envoyer la photo/ }).click()
}

const join = async (guest: Page, url: string, joinCode: string): Promise<void> => {
  await guest.goto(`${url}/join/${joinCode}`)
  await guest.getByLabel(/Votre prénom/i).fill('Léa')
  await guest.getByRole('button', { name: /Rejoindre/i }).click()
  await guest.waitForURL(/\/e\/[^/]+\/upload/)
}

test('a photo picked with no connection reaches the wall once the network returns @offline', async ({
  app,
  surfaces,
}) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'mariage', name: 'Camille & Sacha' })

  await projector.goto(app.url(`/e/${event.slug}/display`))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()

  // --- Guest: joins while the venue Wi-Fi is still holding up.
  await join(guest, app.baseUrl, event.joinCode)

  // --- And then it does not. This is the 19:00-to-23:00 window the feature exists for.
  await guest.context().setOffline(true)
  await sendOne(guest, await aPhoto('confettis', 1200, 900))

  // The row says the photo is waiting, not that it failed. A guest told "Échec" sends
  // it again; a guest told it is on its way puts the phone back in their pocket.
  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'queued')
  await expect(guest.getByTestId('offline-notice')).toBeVisible()
  await expect(guest.getByTestId('offline-waiting')).toHaveText(/1 photo attend le réseau/)

  // --- Nothing reached the server. Asserted, because a queue that silently uploaded
  //     anyway would pass every other assertion in this test.
  const beforeReconnect = await host.request.get(
    app.url(`/api/events/${event.slug}/moderation?status=all`),
  )
  expect(((await beforeReconnect.json()) as { items: unknown[] }).items).toHaveLength(0)

  // --- The guest walks back into range. Nobody presses anything.
  await guest.context().setOffline(false)

  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done', {
    timeout: 20_000,
  })
  await expect(guest.getByTestId('offline-notice')).toBeHidden()

  // --- Host: it arrives in the queue like any other photo, and still needs a decision.
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  const card = host.getByTestId('moderation-card').first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  await card.getByRole('button', { name: 'Publier' }).click()

  // --- Projector: a photo that was picked with no network at all is now in the room.
  await expect(projector.getByTestId('wall-slide').first()).toBeVisible({ timeout: 15_000 })
})

test('a photo outlives the tab that picked it @offline', async ({ app, surfaces }) => {
  // The difference between an outbox and a retry button. A guest who gives up and
  // closes the page — or whose browser discards the tab in their pocket — must not lose
  // the photo, which is only true if the bytes are in IndexedDB rather than in memory.
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'reload', name: 'Camille & Sacha' })

  await join(guest, app.baseUrl, event.joinCode)

  await guest.context().setOffline(true)
  await sendOne(guest, await aPhoto('perdue', 1200, 900))
  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'queued')

  // The reload throws away every piece of React state there is. The count coming back
  // is the proof that the bytes were on the device rather than in the tab — and the
  // whole difference between an outbox and a retry button.
  await guest.context().setOffline(false)
  await guest.reload()
  await expect(guest.getByTestId('offline-waiting')).toHaveText(/1 photo attend le réseau/)

  // And then it goes, without the guest touching anything.
  await expect(guest.getByTestId('offline-notice')).toBeHidden({ timeout: 20_000 })
  await expect(guest.getByText('En attente de validation')).toBeVisible({ timeout: 15_000 })
})

test('the kill switch removes the queue from a phone already carrying it @offline', async ({
  app,
  surfaces,
}) => {
  // The property that makes shipping a service worker survivable: a bad worker already
  // installed on a guest's phone can be taken off it, and the photos it was holding go
  // with it rather than being stranded where nothing will ever drain them.
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'kill', name: 'Camille & Sacha' })

  await join(guest, app.baseUrl, event.joinCode)
  await guest.context().setOffline(true)
  await sendOne(guest, await aPhoto('abandonnee', 1200, 900))
  await expect(guest.getByTestId('offline-notice')).toBeVisible()

  await guest.context().setOffline(false)
  await guest.goto(app.url(`/e/${event.slug}/upload?offline=off`))

  // No queue, and no worker left to run one.
  await expect(guest.getByTestId('offline-notice')).toBeHidden()
  await expect
    .poll(
      () => guest.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
      { timeout: 15_000 },
    )
    .toBe(0)
})

test('the app opens with no connection once it has been visited @offline', async ({
  app,
  surfaces,
}) => {
  // What an installed app is for. Before the worker cached the shell, an EventSlide on
  // somebody's home screen opened to the browser's offline page — and Chromium will not
  // fire `beforeinstallprompt` at all for an app with no `fetch` handler, so the offer to
  // install it never appeared either.
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'shell', name: 'Camille & Sacha' })

  await join(guest, app.baseUrl, event.joinCode)
  // The worker installs and precaches asynchronously; it is in control once it says so.
  await guest.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 20_000,
  })

  await guest.context().setOffline(true)
  await guest.reload()

  // The app boots from the cache, and the guest is still on their own upload screen —
  // the join step is remembered per tab, so a reload with no network lands exactly where
  // they were rather than on a browser error page. The API is unreachable, so "Vos
  // envois" says so; the picker is there and the outbox will take whatever they add.
  await expect(guest.getByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(guest.getByTestId('photo-input')).toBeAttached()
})
