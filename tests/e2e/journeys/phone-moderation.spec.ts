import { expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host is not at the laptop.
 *
 * They are at a table, standing, holding a phone, and the photo they are about to judge
 * goes on a wall in front of two hundred people. This journey is the one thing no
 * cheaper ring can answer about that: whether a real thumb travelling across a real
 * phone viewport reaches a decision that a real server records and a second screen then
 * shows.
 *
 * The gesture arithmetic is unit-tested (`web/src/features/moderation/swipe/`), and the
 * view is component-tested against a fake transport. What is left here is the part that
 * only exists in a browser: pointer events from real input, a layout with real
 * dimensions — so touch targets can actually be measured — and SSE crossing two
 * contexts.
 */

/**
 * Run on every phone project, and only on those.
 *
 * `isMobile` rather than a list of project names, for two reasons. It is true for both
 * `chromium-mobile` (Pixel 7) and `webkit-mobile` (iPhone 14) — and `playwright.config.ts`
 * calls WebKit "the browser the largest share of guests actually use", which is also
 * where `touch-action`, pointer events and `pointercancel` diverge most, so it is the
 * last project this screen should be missing from. And a phone project added later
 * inherits the coverage instead of waiting for somebody to remember a list.
 *
 * At file scope, and taking nothing but that one option, so a skipped run costs a
 * modifier call. The same check inside a test body still builds the real server, its
 * SQLite file and three browser contexts before deciding not to use them.
 */
test.skip(({ isMobile }) => !isMobile, 'the phone console is asserted on the phone projects')

const phoneConsole = (slug: string) => `/admin/events/${slug}/moderation/mobile`

/** 44 px is the floor, not the aspiration — docs/DESIGN-SYSTEM.md section 8. */
const TOUCH_MIN = 44

test('a photo swiped to the right on a phone reaches the wall', async ({
  app,
  page,
  surfaces,
}) => {
  const { guest, projector } = surfaces
  const event = await app.seedEvent({ slug: 'buffet', name: 'Camille & Sacha' })

  await projector.goto(wallUrl(app, event.slug))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()

  // The host's own phone: a separate context from the laptop the fixture signs in, and
  // the project's device, so the viewport and the touch input are the real ones.
  await signInAsHost(page, app)
  await page.goto(app.url(phoneConsole(event.slug)))

  // The photo arrives while the host is standing there, over the stream, with nothing
  // pressed and nothing reloaded.
  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa', caption: 'Les confettis' })
  const card = page.getByTestId('mobile-moderation-card')
  await expect(card).toBeVisible()
  await expect(card.getByText('Les confettis')).toBeVisible()

  await card.scrollIntoViewIfNeeded()
  const box = await card.boundingBox()
  expect(box).not.toBeNull()
  const y = box!.y + box!.height / 2
  const from = box!.x + box!.width / 2

  await page.mouse.move(from, y)
  await page.mouse.down()

  // Barely started, and the card already says which way it is going. This is the
  // assertion that makes the gesture safe: a host who is not told cannot take it back,
  // and the next two lines prove there is still something to take back.
  await page.mouse.move(from + 40, y, { steps: 5 })
  await expect(card).toHaveAttribute('data-intent', 'publish')
  await expect(card).toHaveAttribute('data-committed', 'false')

  await page.mouse.move(box!.x + box!.width - 4, y, { steps: 10 })
  await expect(card).toHaveAttribute('data-committed', 'true')

  // Nothing is decided until the thumb comes off: the projector is still empty here.
  await expect(projector.getByTestId('wall-empty')).toBeVisible()

  await page.mouse.up()

  await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
  await expect(projector.getByTestId('wall-empty')).toBeHidden()
})

test('a swipe dragged back before the thumb lifts decides nothing', async ({
  app,
  page,
  surfaces,
}) => {
  // The way out of a gesture started by mistake. Without it, a swipe is a control that
  // publishes on a misread — which is the reason a dense grid and a keyboard were the
  // safer choice in the first place, and the reason this surface needs the escape hatch
  // to actually work on a real touch stack rather than only in a unit test.
  const { guest, projector } = surfaces
  const event = await app.seedEvent({ slug: 'apero' })

  await projector.goto(wallUrl(app, event.slug))
  await signInAsHost(page, app)
  await page.goto(app.url(phoneConsole(event.slug)))
  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Tom' })

  const card = page.getByTestId('mobile-moderation-card')
  await expect(card).toBeVisible()
  await card.scrollIntoViewIfNeeded()
  const box = await card.boundingBox()
  expect(box).not.toBeNull()
  const y = box!.y + box!.height / 2
  const from = box!.x + box!.width / 2

  await page.mouse.move(from, y)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width - 4, y, { steps: 10 })
  await expect(card).toHaveAttribute('data-committed', 'true')

  // Back where it started, and the card says the decision is off.
  await page.mouse.move(from + 4, y, { steps: 10 })
  await expect(card).toHaveAttribute('data-committed', 'false')

  await page.mouse.up()

  // The photo is still the one in hand, and the wall never heard about any of it.
  await expect(card).toBeVisible()
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  await expect(projector.getByTestId('wall-slide')).toHaveCount(0)
})

test('reduced motion takes the travel away, not the decision', async ({
  app,
  page,
  surfaces,
}) => {
  /**
   * `prefers-reduced-motion` is a health requirement, not a preference: a card easing
   * across a phone held at reading distance is the kind of motion that triggers
   * vestibular symptoms. What it must not take with it is the gesture — a card that
   * stopped following the thumb would be a screen a host cannot use at all, which is
   * how "respecting" the preference turns into excluding the people who set it.
   *
   * The collapsed duration below is `base.css` doing its job for every element, not
   * this card's own media query — so what this test protects is the outcome for the
   * card (no `!important` transition, no animation smuggled in on it) together with the
   * half that is genuinely local: the swipe still decides.
   */
  const { guest, projector } = surfaces
  const event = await app.seedEvent({ slug: 'sans-mouvement' })

  await projector.goto(wallUrl(app, event.slug))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signInAsHost(page, app)
  await page.goto(app.url(phoneConsole(event.slug)))
  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa' })

  const card = page.getByTestId('mobile-moderation-card')
  await expect(card).toBeVisible()

  // Under no preference this is `--duration-base`, 240 ms.
  const milliseconds = await card.evaluate(
    (node) => Number.parseFloat(getComputedStyle(node).transitionDuration) * 1_000,
  )
  expect(milliseconds).toBeLessThan(1)

  await card.scrollIntoViewIfNeeded()
  const box = await card.boundingBox()
  expect(box).not.toBeNull()
  const y = box!.y + box!.height / 2

  await page.mouse.move(box!.x + box!.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width - 4, y, { steps: 10 })
  await expect(card).toHaveAttribute('data-committed', 'true')
  await page.mouse.up()

  await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
})

test('every decision is reachable without a gesture', async ({ app, page, surfaces }) => {
  // A swipe-only console is unusable with a screen reader and unusable one-handed by
  // somebody with limited mobility. The buttons are not a fallback, they are the
  // accessible path — and whether a thumb can actually hit them is a question about a
  // real layout, which is what puts this assertion in this ring rather than in jsdom,
  // where every element measures zero.
  const { guest, projector } = surfaces
  const event = await app.seedEvent({ slug: 'kermesse-mobile' })

  await projector.goto(wallUrl(app, event.slug))
  await signInAsHost(page, app)
  await page.goto(app.url(phoneConsole(event.slug)))
  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa' })
  await expect(page.getByTestId('mobile-moderation-card')).toBeVisible()

  // Matched on the verb alone: a decision button is named after the photo's author, and
  // the queue endpoint sends `authorName: null` for every photo, so naming the guest
  // here would pin a separate defect onto a test about the buttons.
  const publish = page.getByRole('button', { name: /^Publier/ })
  const refuse = page.getByRole('button', { name: /^Refuser/ })

  for (const decision of [refuse, publish]) {
    const box = await decision.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(TOUCH_MIN)
  }

  await refuse.click()

  // A refusal, taken with no gesture at all, and the wall stays exactly as it was.
  // The heading, not the text: the same sentence is also in the live region that tells
  // a host who is not looking at the phone that the queue has run out.
  await expect(page.getByRole('heading', { name: fr.moderation.empty })).toBeVisible()
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  await expect(projector.getByTestId('wall-slide')).toHaveCount(0)
})
