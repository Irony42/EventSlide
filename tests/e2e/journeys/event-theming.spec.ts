import { expect, test } from '../fixtures/app'
import type { Page } from '@playwright/test'

/**
 * Roadmap 2.2, end to end: the host picks a colour on a laptop and the room changes.
 *
 * This earns its seconds the way CLAUDE.md section 5 asks a ring-6 test to — it crosses
 * two surfaces, and what it proves cannot be proved one ring down. The component tests
 * know that `WallPage` puts `--accent-hue` on its own element; only a real browser knows
 * that `oklch(72% 0.17 var(--accent-hue))` in `tokens.css` resolves *through* it into a
 * different colour. Those are different claims and the second one is the feature.
 *
 * The guest surface is left out on purpose: it wears the same custom property by the same
 * mechanism, and a third context here would buy a slower suite rather than a new fact.
 *
 * The first one is `@smoke`, so it also runs on Firefox in CI. It is the assertion with
 * real cross-browser risk — `oklch()` resolving a custom property, re-derived on a
 * descendant — and it is the half a screenshot on one engine cannot cover.
 */

/** What the browser computes for `--accent` on an element, after substitution. */
const accentOn = (page: Page, selector: string): Promise<string> =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => getComputedStyle(element).getPropertyValue('--accent').trim())

test('a host picks the event’s colour and the room wears it @smoke', async ({ app, surfaces }) => {
  const { host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'theme-rose', name: 'Camille & Sacha' })

  await projector.goto(app.url(`/e/${event.slug}/display`))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()

  // The product's own accent, before anybody chooses anything.
  const before = await accentOn(projector, 'body')
  expect(before).not.toBe('')

  await host.goto(app.url(`/admin/events/${event.slug}/settings`))
  await host.getByRole('radio', { name: 'Rose' }).check()
  // Exact, because the schedule below the settings has its own "Enregistrer l’horaire".
  await host.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(host.getByText('Réglages enregistrés.')).toBeVisible()

  // **No reload.** The projector is a machine in the corner that nobody is going to
  // touch, so the change has to arrive over SSE on the wall that is already running —
  // and on the empty wall, which is the screen the host is looking at while they choose,
  // the playlist revision never changes at all. An earlier draft reloaded here and the
  // test passed while the feature did not.

  // The angle reached the element that renders the room, and nothing else on the page
  // carries a colour of its own.
  const themed = projector.locator('[style*="--accent-hue"]')
  await expect(themed).toHaveCount(1)

  // The stylesheet resolved that angle into a different colour — the half no component
  // test can see, because jsdom computes no custom property.
  const after = await accentOn(projector, '[style*="--accent-hue"]')
  expect(after).not.toBe(before)
  expect(after).toContain('345')
})

test('an event nobody themed carries nothing at all', async ({ app, surfaces }) => {
  // The other half of the promise, and the one the committed wall baselines rest on: a
  // default theme is not "the default values on the element", it is no attribute and no
  // inline style, so the DOM is the DOM that shipped.
  const { projector } = surfaces
  const event = await app.seedEvent({ slug: 'theme-defaut', name: 'Camille & Sacha' })

  await projector.goto(app.url(`/e/${event.slug}/display`))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()

  await expect(projector.locator('[style*="--accent-hue"]')).toHaveCount(0)
  await expect(projector.locator('[data-event-fonts]')).toHaveCount(0)
  await expect(projector.locator('[data-event-frame]')).toHaveCount(0)
})
