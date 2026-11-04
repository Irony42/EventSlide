import { csrfHeaders, expect, joinAsGuest, signInAsHost, test } from '../fixtures/app'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A guest writes a word, and the host decides it from the moderation console (spec 15).
 *
 * One journey, because only the real chain closes it: a message written on a phone, the bus,
 * the moderation stream reaching a console that is already open, the badge moving without a
 * reload, a key press publishing the message, and the projector showing it. The rules (the
 * order, the allowed decisions, the keys, the tabs) are tested one ring down.
 */
test('a guest message reaches the open console, is published with the keyboard and shows on the wall', async ({
  app,
  surfaces,
}) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'livre-or-console', name: 'Camille & Sacha' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  // The tab exists as soon as the event says it has a guestbook, with nothing waiting yet.
  await expect(host.getByRole('tab', { name: fr.moderation.tabMessages })).toBeVisible()

  await joinAsGuest(guest, app, event.joinCode, 'Léa')
  const written = await guest.request.post(app.url(`/api/events/${event.slug}/guestbook`), {
    headers: await csrfHeaders(guest.request, app),
    data: { text: 'Bravo les mariés' },
  })
  expect(written.status()).toBe(201)

  // The badge moves on the console that is already open: no reload.
  const tab = host.getByRole('tab', {
    name: fr.moderation.tabCounted(fr.moderation.tabMessages, 1),
  })
  await expect(tab).toBeVisible()
  await tab.click()
  await expect(host.getByText('Bravo les mariés')).toBeVisible()

  // J puts the keyboard on the first message, P publishes it.
  await host.keyboard.press('j')
  await host.keyboard.press('p')
  await expect(host.getByText(fr.moderation.messagePublished('Léa'))).toBeAttached()

  // What the room is served: the wall reads only published messages, so this is the host's key press.
  await expect
    .poll(async () => {
      const wall = await projector.request.get(app.url('/api/events/' + event.slug + '/wall'))
      const body = (await wall.json()) as { guestbook?: { messages?: { text: string }[] } }
      return body.guestbook?.messages?.map((message) => message.text) ?? []
    })
    .toContain('Bravo les mariés')
})
