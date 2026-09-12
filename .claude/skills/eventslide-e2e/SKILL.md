---
name: eventslide-e2e
description: Recipe for writing and running end-to-end tests with Playwright in tests/e2e — the real server on a throwaway SQLite database, real uploads, real SSE, three-surface journeys (guest phone, host desktop, projector), plus visual and accessibility checks. Use when adding a user journey, changing a flow that spans surfaces, or verifying that a photo actually reaches the wall.
---

# End-to-end tests

E2E answers the one question no other ring can: **does a photo taken on a phone
actually appear on the projector?** That path crosses a mobile browser, an HTTP
upload, `sharp`, SQLite, a moderation decision, an SSE frame, and a second browser
context. Every ring below it passes with that path broken.

Everything else is cheaper elsewhere. E2E is expensive and flaky by nature, so it
covers **journeys and cross-surface contracts only**.

```
tests/e2e/
  fixtures/
    app.ts             # server-per-worker fixture, throwaway DB + media root
    surfaces.ts        # guestPhone / hostDesktop / projector browser contexts
    media.ts           # generated JPEGs, one with EXIF orientation 6 and GPS
  journeys/
    guest-upload.spec.ts
    moderation.spec.ts
    display-wall.spec.ts
    host-onboarding.spec.ts
    album-sharing.spec.ts
  security/
    tenant-isolation.spec.ts
    guest-token-scope.spec.ts
    upload-hardening.spec.ts
  a11y/
    accessibility.spec.ts
  visual/
    display.spec.ts    # screenshot comparison of the wall layouts
```

## Running

```bash
npx playwright install --with-deps    # once
npm run test:e2e                      # headless, all projects
npm run test:e2e:ui                   # Playwright UI, for debugging
npm run test:e2e -- --project=chromium-mobile
npm run test:e2e:offline               # the offline upload queue
npm run test:e2e -- --grep @smoke     # the CI-on-every-push subset
npm run test:e2e:update-snapshots     # after an intentional visual change
```

Projects: `chromium-desktop` (host + projector), `chromium-mobile` (Pixel 7, guest),
`webkit-mobile` (iPhone 14 — the browser most guests actually use), `firefox-desktop`,
and `chromium-offline`.

`chromium-offline` is the only project that runs `tests/e2e/offline/`, and the only one
that may: those specs cut the network out from under a live page with
`context.setOffline(true)`, which every other journey would rather not inherit by
accident. Every other project carries `testIgnore: '**/offline/**'`. It is Chromium-only
because a Playwright context gives a service worker a dependable registration there and
not in WebKit — and a permanently-red project is a project people stop reading. What
those specs assert is the **foreground** drain, the path every guest gets with or
without a worker; Background Sync is a bonus the browser may or may not grant and no
assertion depends on it.

## The app fixture: real server, disposable everything

```ts
// tests/e2e/fixtures/app.ts
import { test as base } from '@playwright/test'
import { startTestApp, type TestApp } from './startTestApp'

export const test = base.extend<{ app: TestApp }>({
  app: [
    async ({}, use, workerInfo) => {
      // One server per worker, on its own port, its own SQLite file, its own
      // media root — so workers cannot see each other's photos.
      const app = await startTestApp({ worker: workerInfo.workerIndex })
      await use(app)
      await app.dispose() // closes the server, removes the DB and media dir
    },
    { scope: 'worker' },
  ],
})

export { expect } from '@playwright/test'
```

Non-negotiables:

- **Real migrated database**, `data/e2e-<worker>.sqlite`, deleted afterwards. Never
  the dev database.
- **Real media root** under the OS temp dir, deleted afterwards.
- **No network stubbing.** If you find yourself stubbing a route, the test belongs in
  another ring.
- **Seeding through the API or a seed script**, never by writing SQL in a spec. Seeding
  via the public surface is itself a test.
- Deterministic secrets and a fixed `E2E_CLOCK_EPOCH` so snapshots are stable.

## Three surfaces, three contexts

The whole product is three people looking at three screens at once. Model that
literally.

```ts
// tests/e2e/journeys/guest-upload.spec.ts
import { test, expect } from '../fixtures/app'
import { openSurfaces } from '../fixtures/surfaces'
import { jpegWithOrientation } from '../fixtures/media'

test('a photo uploaded on a phone reaches the wall once the host approves it @smoke', async ({
  app,
  browser,
}) => {
  const { guest, host, projector } = await openSurfaces(browser, app)
  const event = await app.seedEvent({ slug: 'mariage', name: 'Camille & Sacha' })

  // --- Projector: running before anyone arrives.
  await projector.goto(app.url(`/e/${event.slug}/display`))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()

  // --- Guest: scans the QR, lands on the join page, no account.
  await guest.goto(app.url(`/join/${event.joinCode}`))
  await guest.getByLabel('Votre prénom').fill('Léa')
  await guest.getByRole('button', { name: 'Rejoindre' }).click()
  await expect(guest.getByRole('heading', { name: /Camille & Sacha/ })).toBeVisible()

  await guest
    .getByTestId('photo-input')
    .setInputFiles(await jpegWithOrientation(6, { label: 'confettis' }))
  await guest.getByLabel('Légende').fill('Les confettis !')
  await guest.getByRole('button', { name: /Envoyer/ }).click()
  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')

  // --- Projector: still empty. Nothing is published without a decision.
  await expect(projector.getByTestId('wall-empty')).toBeVisible()

  // --- Host: the photo arrives in the queue over SSE, with no reload.
  await host.goto(app.url('/admin/events/mariage/moderation'))
  const card = host.getByTestId('moderation-card').first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card.getByText('Les confettis !')).toBeVisible()
  await card.getByRole('button', { name: 'Publier' }).click()

  // --- Projector: appears over SSE, no reload, right way up.
  const slide = projector.getByTestId('wall-slide').first()
  await expect(slide).toBeVisible({ timeout: 10_000 })
  await expect(slide.getByText('Les confettis !')).toBeVisible()
  await expect(slide.getByText('Léa')).toBeVisible()

  // EXIF orientation 6 is a portrait photo. If `sharp(...).rotate()` were dropped,
  // the stored image would be landscape and this assertion is the only ring that
  // would notice.
  const box = await slide.getByRole('img').boundingBox()
  expect(box!.height).toBeGreaterThan(box!.width)
})
```

What makes that test worth its runtime:

- It crosses **three browser contexts** and asserts real-time propagation both ways.
- It asserts the **negative**: the wall stays empty until moderation. A test that only
  checks the happy end would pass with moderation entirely bypassed.
- It asserts **orientation from pixel dimensions**, catching a class of bug invisible
  to unit tests.

## Selectors

Priority order, and it is not a suggestion:

1. `getByRole` / `getByLabel` / `getByText` — user-visible, so it doubles as an
   accessibility assertion.
2. `getByTestId` — only for things with no accessible identity: a slide layer, a
   canvas, an upload queue row.
3. **Never** a CSS class or DOM structure selector. `.btn-primary > div:nth-child(2)`
   breaks on every restyle and tests nothing a user cares about.

`data-testid` values are part of the contract. Renaming one is a breaking change: grep
before you touch it.

## Waiting

- `await expect(locator).toBeVisible()` — auto-retrying, use this.
- `page.waitForTimeout()` — **banned**, lint rejects it. It is the entire source of
  flake in an SSE-driven app.
- SSE arrival: assert on the resulting DOM with a generous timeout (10 s), never on a
  timer.
- The slideshow advances on an interval. Drive it with
  `?e2e_interval=250&e2e_transition=0` (only honoured when `E2E_HOOKS=1`) rather than
  waiting ten real seconds.

## Security journeys

These are the tests that justify the suite existing.

```ts
// tests/e2e/security/guest-token-scope.spec.ts
test('a guest token from one event cannot upload to another', async ({
  app,
  browser,
}) => {
  const wedding = await app.seedEvent({ slug: 'mariage' })
  const gala = await app.seedEvent({ slug: 'gala' })

  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(app.url(`/join/${wedding.joinCode}`))
  await page.getByLabel('Votre prénom').fill('Léa')
  await page.getByRole('button', { name: 'Rejoindre' }).click()

  // Same cookie jar, different event: the request must be refused server-side.
  const response = await context.request.post(
    app.url(`/api/events/${gala.slug}/photos`),
    {
      multipart: {
        photos: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await tinyJpeg() },
      },
    },
  )
  expect(response.status()).toBe(403)
})
```

Cover at minimum: guest token scoped to one event; a moderator of event A refused on
event B; a `.php`/`.svg`/polyglot upload rejected on magic bytes; oversize and
pixel-bomb uploads rejected; the event quota closing uploads; a guest unable to delete
someone else's photo; media URLs from event A returning 404 for a session on event B.

## Accessibility

```ts
import AxeBuilder from '@axe-core/playwright'

for (const path of [
  '/join/DEMO123',
  '/e/demo/upload',
  '/admin',
  '/admin/events/demo/moderation',
]) {
  test(`${path} has no serious accessibility violation`, async ({ app, page }) => {
    await page.goto(app.url(path))
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    expect(
      violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
    ).toEqual([])
  })
}
```

The projector page is exempt from contrast rules by design (it is a photo on black)
but must still be keyboard-operable.

## Visual regression

Only the display wall, where "looks right" _is_ the requirement.

```ts
test('mosaic layout renders as designed', async ({ app, page }) => {
  await page.goto(app.url('/e/demo/display?layout=mosaic&e2e_transition=0'))
  await expect(page.getByTestId('wall-slide').first()).toBeVisible()
  await expect(page).toHaveScreenshot('wall-mosaic.png', { maxDiffPixelRatio: 0.01 })
})
```

Requires the seeded demo album (fixed photo set), `e2e_transition=0`, and animations
disabled via `prefers-reduced-motion`. Update snapshots deliberately with
`npm run test:e2e:update-snapshots`, and eyeball the diff before committing it.

## Flake policy

`retries: 2` in CI, `0` locally. A test that needs a retry locally is broken — fix it,
do not retry it. Common causes here, in order: a missing auto-retrying assertion, a
`waitForTimeout`, shared state between workers, or an unseeded clock.

Never `test.skip` a failing e2e without an issue link and a comment stating what
broke.

## Checklist

- [ ] The journey crosses at least two surfaces, or asserts something no cheaper ring can.
- [ ] Real server, throwaway DB and media root, disposed in the fixture.
- [ ] Role/label selectors first; `data-testid` only where there is no accessible identity.
- [ ] No `waitForTimeout`; auto-retrying assertions only.
- [ ] Asserts a negative as well as a positive (nothing published without a decision).
- [ ] `@smoke` tag if it must run on every push.
- [ ] Security journeys updated when authorization changes.
- [ ] `npm run test:e2e` green locally before pushing.
