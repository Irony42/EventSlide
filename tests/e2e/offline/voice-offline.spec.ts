import type { Page } from '@playwright/test'
import { expect, joinAsGuest, test } from '../fixtures/app'
import { passPrivacyNotice } from '../fixtures/guest'
import { hasEncoder } from '../fixtures/media'
import { FAKE_MICROPHONE, openRecorder, recordTake, sendTake } from '../fixtures/voice'
import type { TestApp } from '../fixtures/startTestApp'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A voice message recorded with no network reaches the box once the network returns, once
 * (spec 25). The path crosses a real `MediaRecorder` file, the voice queue's own IndexedDB
 * (`eventslide-voice`, not the photographs'), a real upload and ffmpeg. The network is cut with
 * `context.setOffline`, as in `offline-upload.spec.ts`; nothing is stubbed.
 *
 * Chromium only, like every offline journey (a dependable service-worker registration).
 */
test.use({ launchOptions: { args: FAKE_MICROPHONE } })
test.skip(() => !hasEncoder(), 'no ffmpeg on this machine: a recording cannot be transcoded')

const arrive = async (guest: Page, app: TestApp, joinCode: string): Promise<void> => {
  await joinAsGuest(guest, app, joinCode, 'Léa')
  await passPrivacyNotice(guest)
}

/** The guestbook entries the box holds, read by the host's own API. */
const entriesOf = async (host: Page, app: TestApp, slug: string): Promise<unknown[]> => {
  const reply = await host.request.get(app.url(`/api/events/${slug}/guestbook`))
  return ((await reply.json()) as { items: unknown[] }).items
}

test('a recording made with no connection waits, then goes once the network returns @offline', async ({
  app,
  surfaces,
}) => {
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'voix-hors-ligne', template: 'wedding' })
  await arrive(guest, app, event.joinCode)
  await openRecorder(guest)

  await guest.context().setOffline(true)
  await recordTake(guest, 2)
  await sendTake(guest, 'Depuis le fond de la salle')

  // Kept on the phone and said so, not failed: a guest told "échec" records it again.
  await expect(guest.getByText(fr.guestbookVoice.waitingNetwork).first()).toBeVisible()
  await expect(guest.getByTestId('local-voice')).toHaveCount(1)
  expect(await entriesOf(host, app, event.slug), 'nothing reached the box offline').toHaveLength(0)

  await guest.context().setOffline(false)
  await expect(guest.getByTestId('local-voice')).toHaveCount(0, { timeout: 30_000 })

  // One entry, not two: a retry that raced the first send would leave a second.
  await expect.poll(() => entriesOf(host, app, event.slug), { timeout: 30_000 }).toHaveLength(1)
  await guest.reload()
  await expect(guest.getByText(/Message vocal, 0:0[1-3]/)).toHaveCount(1)
  expect(await entriesOf(host, app, event.slug)).toHaveLength(1)
})

test('a page reopened offline by the service worker still has its microphone @offline', async ({
  app,
  surfaces,
}) => {
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'voix-repli', template: 'wedding' })
  await arrive(guest, app, event.joinCode)
  await guest.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 20_000,
  })

  // The document a failed navigation is answered with keeps the policy it was cached with: the
  // browser's own verdict on the page, asked of the page.
  await guest.context().setOffline(true)
  const reopened = await guest.goto(app.url(`/e/${event.slug}/upload`))
  expect(reopened?.fromServiceWorker()).toBe(true)
  expect(reopened?.headers()['permissions-policy']).toContain('microphone=(self)')
  await expect(guest.getByRole('heading', { level: 1, name: /Camille/ })).toBeVisible({
    timeout: 20_000,
  })
  const allowed = await guest.evaluate(() =>
    (
      document as Document & { featurePolicy?: { allowsFeature: (name: string) => boolean } }
    ).featurePolicy?.allowsFeature('microphone'),
  )
  expect(allowed).toBe(true)

  // And it records: the capture does not need the network, only the page's right to ask.
  const taken = await guest.evaluate(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      return 'granted'
    } catch (error) {
      return (error as Error).name
    }
  })
  expect(taken).toBe('granted')
})
