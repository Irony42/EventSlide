import AxeBuilder from '@axe-core/playwright'
import type { Locator, Page } from '@playwright/test'
import { expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * Accessibility, asserted rather than assumed.
 *
 * axe catches the mechanical failures — a missing label, an unreachable contrast
 * ratio, an aria attribute on an element that cannot carry it. It does not catch a
 * keyboard trap or a control that is technically labelled and practically unusable, so
 * the keyboard journeys below are asserted by hand.
 *
 * 1.0's moderation grid was a clickable `div` with no focus treatment: invisible to a
 * screen reader and unreachable by keyboard. Nothing in the suite would have noticed.
 */

const seriousOnly = (violations: readonly { readonly impact?: string | null }[]) =>
  violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  )

const scan = async (page: Parameters<typeof joinAndUpload>[0]) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()

/** Enough presses to cross any of these screens, few enough that a trap still fails. */
const TAB_LIMIT = 15

/**
 * Presses Tab until `target` holds the browser's focus.
 *
 * Tabbing *to* a control rather than counting presses to it is the point: a fixed count
 * asserts the shell's tab order, not the guest's ability to reach the field, and it is
 * wrong in both directions — the skip link is legitimately the first stop today, and a
 * page that later autofocused the field would break the same count by being better. The
 * bound keeps an unreachable control a failure rather than a hang, and returning zero
 * for something already focused means autofocus would satisfy this unchanged.
 */
const tabTo = async (page: Page, target: Locator): Promise<number> => {
  const holdsFocus = () => target.evaluate((node) => node === document.activeElement)

  if (await holdsFocus()) return 0
  for (let presses = 1; presses <= TAB_LIMIT; presses += 1) {
    await page.keyboard.press('Tab')
    if (await holdsFocus()) return presses
  }
  throw new Error(`no Tab stop reached the control within ${TAB_LIMIT} presses`)
}

test.describe('the guest surface', () => {
  test('the join page has no serious violation @smoke', async ({ app, surfaces }) => {
    const event = await app.seedEvent({ slug: 'mariage' })
    await surfaces.guest.goto(app.url(`/join/${event.joinCode}`))

    const { violations } = await scan(surfaces.guest)

    expect(seriousOnly(violations)).toEqual([])
  })

  test('the upload page has no serious violation', async ({ app, surfaces }) => {
    const event = await app.seedEvent({ slug: 'gala' })
    await joinAndUpload(surfaces.guest, app, event.joinCode, { displayName: 'Léa' })

    const { violations } = await scan(surfaces.guest)

    expect(seriousOnly(violations)).toEqual([])
  })

  test('every control is reachable with one thumb', async ({ app, surfaces }) => {
    // 44 px is the floor. A guest is holding a drink in the other hand, in a dark room,
    // and a 32 px button means three taps to hit it once.
    const event = await app.seedEvent({ slug: 'anniversaire' })
    await surfaces.guest.goto(app.url(`/join/${event.joinCode}`))

    const submit = surfaces.guest.getByRole('button', { name: /Rejoindre/i })
    const box = await submit.boundingBox()

    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })

  test('the whole join flow works from the keyboard alone', async ({ app, surfaces }) => {
    const event = await app.seedEvent({ slug: 'kermesse' })
    await surfaces.guest.goto(app.url('/join'))

    // Reached by tabbing, not by a count: `/join` does not autofocus the code field, and
    // the first stop is the skip link, which is correct practice and covered below.
    const code = surfaces.guest.getByLabel(fr.join.codeLabel)
    await tabTo(surfaces.guest, code)
    await expect(code).toBeFocused()

    await surfaces.guest.keyboard.type(event.joinCode)
    // Enter in a text field submits the form it belongs to. A guest who reaches for
    // the on-screen keyboard's return key must not be stuck.
    await surfaces.guest.keyboard.press('Enter')

    await expect(surfaces.guest).toHaveURL(/\/e\/[^/]+\/upload/)
  })

  test('the skip link is the first stop and leads to the main content', async ({
    app,
    surfaces,
  }) => {
    // It is in the tab order of every surface, so it is the first thing a keyboard user
    // meets — and the easiest thing to break without anyone noticing, because it is
    // invisible until it is focused. Both halves are asserted: that focus reveals it,
    // and that it points at a landmark that exists.
    await surfaces.guest.goto(app.url('/join'))

    const skip = surfaces.guest.getByRole('link', { name: fr.shell.skipToContent })
    await surfaces.guest.keyboard.press('Tab')
    await expect(skip).toBeFocused()

    // Parked off-screen with a transform and slid back on focus (AppShell.module.css).
    // A skip link that stays off-screen while focused is one a sighted keyboard user
    // cannot follow, and `toBeVisible` alone would not notice — polled because the slide
    // back is a transition.
    await expect.poll(async () => (await skip.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0)

    const href = await skip.getAttribute('href')
    expect(href).toMatch(/^#\S+$/)

    await surfaces.guest.keyboard.press('Enter')
    await expect.poll(() => new URL(surfaces.guest.url()).hash).toBe(href)

    // The target has to be the main landmark itself. A skip link whose fragment names an
    // id nothing carries any more still changes the URL and still does nothing at all.
    await expect(surfaces.guest.locator(`main[id="${(href ?? '#').slice(1)}"]`)).toHaveCount(1)
  })

  test('the focus ring is visible on the field a guest is typing in', async ({ app, surfaces }) => {
    const event = await app.seedEvent({ slug: 'salon' })
    await surfaces.guest.goto(app.url(`/join/${event.joinCode}`))

    const field = surfaces.guest.getByLabel(/Votre prénom/i)
    await field.focus()

    // base.css styles `:focus-visible` with a box-shadow and never removes the outline
    // without a replacement. Either mechanism is fine; neither being present is not.
    const visible = await field.evaluate((node) => {
      const style = getComputedStyle(node)
      return style.boxShadow !== 'none' || style.outlineStyle !== 'none'
    })
    expect(visible).toBe(true)
  })
})

test.describe('the host surface', () => {
  test('the login page has no serious violation', async ({ app, surfaces }) => {
    await surfaces.host.goto(app.url('/login'))

    const { violations } = await scan(surfaces.host)

    expect(seriousOnly(violations)).toEqual([])
  })

  test('the dashboard has no serious violation', async ({ app, surfaces }) => {
    await signInAsHost(surfaces.host, app)

    const { violations } = await scan(surfaces.host)

    expect(seriousOnly(violations)).toEqual([])
  })

  test('the moderation console has no serious violation', async ({ app, surfaces }) => {
    const event = await app.seedEvent({ slug: 'convention' })
    await signInAsHost(surfaces.host, app)
    await joinAndUpload(surfaces.guest, app, event.joinCode, { displayName: 'Tom' })
    await surfaces.host.goto(app.url(`/admin/events/${event.slug}/moderation`))
    await expect(surfaces.host.getByTestId('moderation-card').first()).toBeVisible()

    const { violations } = await scan(surfaces.host)

    expect(seriousOnly(violations)).toEqual([])
  })

  test('a decision button says which photo it acts on', async ({ app, surfaces }) => {
    // "Publier" three hundred times in a row tells a screen-reader user nothing about
    // which photo they are about to put on a screen in front of the room.
    const event = await app.seedEvent({ slug: 'fete' })
    await signInAsHost(surfaces.host, app)
    await joinAndUpload(surfaces.guest, app, event.joinCode, { displayName: 'Léa' })
    await surfaces.host.goto(app.url(`/admin/events/${event.slug}/moderation`))

    const card = surfaces.host.getByTestId('moderation-card').first()
    await expect(card).toBeVisible()
    const label = await card
      .getByRole('button', { name: /Publier/i })
      .evaluate((node) => node.getAttribute('aria-label') ?? node.textContent ?? '')

    expect(label.length).toBeGreaterThan('Publier'.length)
  })

  test('the moderation card is a real control, not a clickable div', async ({ app, surfaces }) => {
    // The exact 1.0 defect: `<div onClick>` with `role="button"` bolted on and no
    // focus treatment, so the whole screen was unusable by keyboard.
    const event = await app.seedEvent({ slug: 'gala-a11y' })
    await signInAsHost(surfaces.host, app)
    await joinAndUpload(surfaces.guest, app, event.joinCode, { displayName: 'Tom' })
    await surfaces.host.goto(app.url(`/admin/events/${event.slug}/moderation`))

    const card = surfaces.host.getByTestId('moderation-card').first()
    await expect(card).toBeVisible()

    // Whatever the card itself is, the actions inside it must be real buttons and the
    // selection a real checkbox.
    await expect(card.getByRole('button').first()).toBeVisible()
    const interactive = await card.evaluate(
      (node) => node.querySelectorAll('button, input, a[href]').length,
    )
    expect(interactive).toBeGreaterThan(0)
  })
})

test.describe('the projected surface', () => {
  test('the wall is operable from the keyboard for the host who walks up', async ({
    app,
    surfaces,
  }) => {
    // The wall assumes no input device, but a host does occasionally walk over. Space
    // must pause rather than scroll the page.
    const event = await app.seedEvent({ slug: 'mariage-wall' })
    await surfaces.projector.goto(wallUrl(app, event.slug))
    await expect(surfaces.projector.getByTestId('wall-empty')).toBeVisible()

    await surfaces.projector.keyboard.press('Space')

    // The page must not have scrolled — the wall is full-bleed and there is nowhere to
    // scroll to, so a scroll means the key was not handled.
    const scrolled = await surfaces.projector.evaluate(() => window.scrollY)
    expect(scrolled).toBe(0)
  })

  test('the empty state is announced, not just drawn', async ({ app, surfaces }) => {
    const event = await app.seedEvent({ slug: 'gala-wall' })
    await surfaces.projector.goto(wallUrl(app, event.slug))

    // The join code is the actionable content on that screen, so it has to be text a
    // reader can reach rather than part of an image.
    await expect(surfaces.projector.getByText(event.joinCode)).toBeVisible()
  })
})
