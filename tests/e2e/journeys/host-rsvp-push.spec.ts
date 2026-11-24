import Database from 'better-sqlite3'
import { expect, signInAsHost, test } from '../fixtures/app'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
import { startTestApp, type TestApp } from '../fixtures/startTestApp'
import { generateVapidKeys } from '../../../src/infrastructure/push/webPushCrypto'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host's browser notification (spec 30, lot 4, PR 16), through a real server and a real browser.
 *
 * What no cheaper ring can answer: **does the checkbox, with the real service worker registered from
 * the built client, subscribe this browser for this event and unsubscribe it again, and is it simply
 * absent on a box with no keys?** The push service itself is not reachable from a test, so the one
 * thing replaced is the browser's `PushManager` (a subscription with an address of the allowed
 * services and well-formed keys); the registration of the worker, the permission, the server's
 * routes and its table are real. The delivery side (encryption, address guard, batching) is held at
 * the rings below it.
 *
 * Only `chromium-desktop` runs it: the host's laptop is the surface.
 */

const text = fr.rsvp.push
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e-endpoint'

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
})

const rows = (app: TestApp): number => {
  const db = new Database(app.databasePath, { readonly: true })
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n
  } finally {
    db.close()
  }
}

test('a host ticks the box, this browser is subscribed for the event, and unticking forgets it', async ({
  browser,
}, testInfo) => {
  const pair = generateVapidKeys()
  const app = await startTestApp({
    worker: testInfo.workerIndex,
    env: {
      VAPID_PUBLIC_KEY: pair.publicKey,
      VAPID_PRIVATE_KEY: pair.privateKey,
      VAPID_SUBJECT: 'mailto:ops@example.org',
    },
  })
  const context = await browser.newContext({
    baseURL: app.baseUrl,
    locale: SUITE_LOCALE,
    viewport: { width: 1440, height: 900 },
  })
  try {
    // The push service is out of reach of a test: the browser's manager answers with a subscription
    // of an allowed address and well-formed keys, and remembers it for the page's life.
    await context.addInitScript((endpoint) => {
      // A headless Chromium reports `denied` and never shows a prompt, whatever the context grants: the
      // permission is the one thing said here instead of asked, so that the click path is the one run.
      Object.defineProperty(Notification, 'permission', { get: () => 'granted' })
      let held: unknown = null
      const made = {
        endpoint,
        toJSON: () => ({
          endpoint,
          expirationTime: null,
          keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) },
        }),
      }
      PushManager.prototype.getSubscription = async () => held as PushSubscription | null
      PushManager.prototype.subscribe = async () => {
        held = made
        return made as unknown as PushSubscription
      }
    }, ENDPOINT)

    const page = await context.newPage()
    await signInAsHost(page, app)
    const event = await app.seedEvent({ slug: 'fete-notifications', name: 'Léa fête ses 40 ans' })
    await page.goto(app.url(`/admin/events/${event.slug}/rsvps`))

    const box = page.getByRole('checkbox', { name: text.label })
    await expect(box).toBeVisible()
    await expect(box).not.toBeChecked()
    expect(rows(app)).toBe(0)

    // ---- ticking: the permission was granted to the context, the worker is registered, the server stores it.
    const stored = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/events/${event.slug}/push-subscription`) &&
        response.request().method() === 'POST',
    )
    await box.click()
    expect((await stored).status()).toBe(204)
    await expect(box).toBeChecked()
    expect(rows(app)).toBe(1)
    const workers = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    )
    expect(workers).toBe(1)

    // ---- unticking: the server forgets this browser for the event.
    const forgotten = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/events/${event.slug}/push-subscription`) &&
        response.request().method() === 'DELETE',
    )
    await box.click()
    expect((await forgotten).status()).toBe(204)
    await expect(box).not.toBeChecked()
    expect(rows(app)).toBe(0)
  } finally {
    await context.close()
    await app.dispose()
  }
})

test('the box is not offered on a server with no push keys', async ({ app, surfaces }) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'fete-sans-notifications', name: 'Fête sans clé' })

  await host.goto(app.url(`/admin/events/${event.slug}/rsvps`))

  await expect(host.getByRole('heading', { name: fr.rsvp.list.title })).toBeVisible()
  await expect(host.getByRole('checkbox', { name: text.label })).toHaveCount(0)
})
