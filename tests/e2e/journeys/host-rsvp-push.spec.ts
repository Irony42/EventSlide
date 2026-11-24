import Database from 'better-sqlite3'
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { expect, signInAsHost, test } from '../fixtures/app'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
import { startTestApp, type TestApp } from '../fixtures/startTestApp'
import { generateVapidKeys } from '../../../src/infrastructure/push/webPushCrypto'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host's browser notification (spec 30, lot 4, PR 16), through a real server and a real browser.
 *
 * What no cheaper ring can answer: **does the checkbox, with the real service worker registered from
 * the built client, subscribe this browser for this event and unsubscribe it again; does a push that
 * reaches the worker run its handler; does a worker kept only for the notification stay out of the way
 * of the shell after the offline queue is switched off; and is the box simply absent on a box with no
 * keys?** The push service itself is not reachable from a test, so two things are replaced: the
 * browser's `PushManager` (a subscription with an address of the allowed services and well-formed
 * keys, kept for the tab's life) and the permission getter (a headless Chromium reports `denied`
 * whatever a context grants). The worker registration, the permission *request path*, the server's
 * routes and its table, and the delivery of a push to the worker (the DevTools protocol's
 * `ServiceWorker.deliverPushMessage`) are real. The delivery side (encryption, address guard,
 * batching) is held at the rings below.
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

/** A box with push keys, and a signed-in host on a context whose push manager is the stand-in. */
const aHostWithPush = async (
  browser: Browser,
  testInfo: TestInfo,
): Promise<{ app: TestApp; context: BrowserContext; page: Page; slug: string }> => {
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
  await context.addInitScript((endpoint) => {
    // A headless Chromium reports `denied` and never shows a prompt, whatever the context grants: the
    // permission is the one thing said here instead of asked, so that the click path is the one run.
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' })
    // The subscription survives a reload of the tab, as a browser's does.
    const KEY = 'e2e-held-subscription'
    const make = () => ({
      endpoint,
      unsubscribe: async () => {
        window.sessionStorage.removeItem(KEY)
        return true
      },
      toJSON: () => ({
        endpoint,
        expirationTime: null,
        keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) },
      }),
    })
    PushManager.prototype.getSubscription = async () =>
      window.sessionStorage.getItem(KEY) === null ? null : (make() as unknown as PushSubscription)
    PushManager.prototype.subscribe = async () => {
      window.sessionStorage.setItem(KEY, '1')
      return make() as unknown as PushSubscription
    }
  }, ENDPOINT)
  const page = await context.newPage()
  await signInAsHost(page, app)
  const event = await app.seedEvent({ slug: 'fete-notifications', name: 'Léa fête ses 40 ans' })
  return { app, context, page, slug: event.slug }
}

const tick = async (page: Page, slug: string): Promise<void> => {
  const stored = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/events/${slug}/push-subscription`) &&
      response.request().method() === 'POST',
  )
  await page.getByRole('checkbox', { name: text.label }).click()
  expect((await stored).status()).toBe(204)
  await expect(page.getByRole('checkbox', { name: text.label })).toBeChecked()
}

test('a host ticks the box, this browser is subscribed for the event, and unticking forgets it', async ({
  browser,
}, testInfo) => {
  const { app, context, page, slug } = await aHostWithPush(browser, testInfo)
  try {
    await page.goto(app.url(`/admin/events/${slug}/rsvps`))

    const box = page.getByRole('checkbox', { name: text.label })
    await expect(box).toBeVisible()
    await expect(box).not.toBeChecked()
    expect(rows(app)).toBe(0)

    // ---- ticking: the permission is there, the worker is registered, the server stores it.
    await tick(page, slug)
    expect(rows(app)).toBe(1)
    expect(
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    ).toBe(1)

    // ---- unticking: the server forgets this browser for the event.
    const forgotten = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/events/${slug}/push-subscription`) &&
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

test('a push that reaches the worker runs its handler: a notification for the event, worded in French', async ({
  browser,
}, testInfo) => {
  const { app, context, page, slug } = await aHostWithPush(browser, testInfo)
  try {
    const cdp = await context.newCDPSession(page)
    const registrations: string[] = []
    cdp.on('ServiceWorker.workerRegistrationUpdated', (event) => {
      for (const registration of event.registrations)
        registrations.push(registration.registrationId)
    })
    await cdp.send('ServiceWorker.enable')
    await page.goto(app.url(`/admin/events/${slug}/rsvps`))
    await tick(page, slug)
    await expect.poll(() => registrations.length).toBeGreaterThan(0)
    await expect.poll(() => context.serviceWorkers().length).toBe(1)

    // A headless Chromium refuses the worker notification permission whatever is granted, so the one call
    // that needs it records what it is given instead of showing it: everything before it (the message
    // read from the push, its words, its tag, where a click goes) is the worker's real code.
    const [worker] = context.serviceWorkers()
    await worker?.evaluate(() => {
      const shown: unknown[] = []
      ;(self as unknown as { __shown: unknown[] }).__shown = shown
      ServiceWorkerRegistration.prototype.showNotification = async function (title, options) {
        shown.push({ title, ...options })
      }
    })

    // The browser hands the worker a push, as it would one from the push service.
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: new URL(app.baseUrl).origin,
      registrationId: registrations[0] as string,
      data: JSON.stringify({ v: 1, type: 'rsvp.new', slug, count: 3 }),
    })

    await expect
      .poll(async () => worker?.evaluate(() => (self as unknown as { __shown: unknown[] }).__shown))
      .toEqual([
        expect.objectContaining({
          title: 'EventSlide',
          body: '3 nouvelles réponses',
          tag: `eventslide-rsvp-${slug}`,
          renotify: true,
          data: { path: `/admin/events/${slug}/rsvps` },
        }),
      ])

    // A message that is not what the box sends still ends in a notification (a push that shows none is
    // penalised), without a count and without a path of any event.
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: new URL(app.baseUrl).origin,
      registrationId: registrations[0] as string,
      data: 'not json',
    })
    await expect
      .poll(async () =>
        worker?.evaluate(() => (self as unknown as { __shown: unknown[] }).__shown.length),
      )
      .toBe(2)
  } finally {
    await context.close()
    await app.dispose()
  }
})

test('with the offline queue off and a notification subscribed, the worker stays but serves no shell, even after a reload', async ({
  browser,
}, testInfo) => {
  const { app, context, page, slug } = await aHostWithPush(browser, testInfo)
  try {
    const here = app.url(`/admin/events/${slug}/rsvps`)
    await page.goto(here)
    await tick(page, slug)
    // The queue is on: the worker precached the app shell.
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await caches.keys()).some((n) => n.startsWith('eventslide-shell-')),
        ),
      )
      .toBe(true)

    // The queue is switched off (`?offline=off`): the registration is kept, the shell is dropped.
    await page.goto(`${here}?offline=off`)
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).sort()))
      .toEqual(['eventslide-push-only'])
    expect(
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    ).toBe(1)

    // A reload: the worker may have been stopped and started again, and it still serves no shell.
    await page.reload()
    await expect(page.getByRole('checkbox', { name: text.label })).toBeChecked()
    expect(await page.evaluate(async () => (await caches.keys()).sort())).toEqual([
      'eventslide-push-only',
    ])
    expect(rows(app)).toBe(1)

    // The queue is on again: the worker serves the shell as before.
    await page.goto(`${here}?offline=on`)
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await caches.keys()).some((n) => n.startsWith('eventslide-shell-')),
        ),
      )
      .toBe(true)
  } finally {
    await context.close()
    await app.dispose()
  }
})

test('signing out forgets this browser for every event, and the account stops receiving', async ({
  browser,
}, testInfo) => {
  const { app, context, page, slug } = await aHostWithPush(browser, testInfo)
  try {
    await page.goto(app.url(`/admin/events/${slug}/rsvps`))
    await tick(page, slug)
    expect(rows(app)).toBe(1)

    await page.getByRole('button', { name: fr.auth.accountMenu }).click()
    await page.getByRole('button', { name: fr.auth.logout, exact: true }).click()

    await expect(page).toHaveURL(/\/login/)
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
