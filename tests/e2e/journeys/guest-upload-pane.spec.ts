import type { Locator, Page } from '@playwright/test'
import { expect, joinAsGuest, test } from '../fixtures/app'
import { passPrivacyNotice } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'
import { sessionOn, succeeded } from '../fixtures/session'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
import { fr } from '../../../web/src/lib/i18n/fr'
import { de } from '../../../web/src/lib/i18n/de'

/**
 * The upload pane on a small phone, after the guest has sent several photos.
 *
 * The pane at the bottom of the upload screen (`upload-composer`) holds the queue and every
 * control, and it grows with each photo. It is `position: sticky`, so a pane taller than the
 * screen covers the guest's own photographs ("Vos envois") for good: they scroll behind it and
 * the top of the pane — "Ajouter des photos" — can never be scrolled to either.
 *
 * What a guest needs from this screen is a fact about **geometry**, so that is what is asserted,
 * and no pixel is compared: a pane that is pinned may take only so much of the screen, and
 * every photograph of theirs and every control can be brought to a place the pane is not.
 * `elementFromPoint` is the honest question — it is what a thumb would hit. Nothing here reads
 * a row's height, so a restyle of the rows moves no assertion.
 */

/** The most of the screen a pane that is pinned may take. The token says two thirds; this is
 *  looser on purpose, so the spec states the requirement and the token states the design. */
const MAX_PINNED_SHARE = 0.7

const PHOTOS = 6

interface Phone {
  readonly name: string
  readonly width: number
  readonly height: number
  /** The browser's text size, as a percentage — a guest who has turned it up. */
  readonly textSize: number
}

const PHONES: readonly Phone[] = [
  { name: 'iPhone SE, 375x667', width: 375, height: 667, textSize: 100 },
  { name: 'small Android, 360x640', width: 360, height: 640, textSize: 100 },
  { name: 'narrowest phone, 320x568, text at 200%', width: 320, height: 568, textSize: 200 },
]

/**
 * Whether the middle of `target` is what a touch there would reach — after scrolling it as far
 * into view as the page allows. `behavior: 'instant'` because the page smooth-scrolls, and a
 * measurement taken mid-scroll is a measurement of nothing.
 */
const reachable = (target: Locator): Promise<boolean> =>
  target.evaluate((element) => {
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
    const box = element.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return hit !== null && element.contains(hit)
  })

/** What the pane is doing to the viewport right now. */
const pinnedShare = (
  pane: Locator,
): Promise<{ readonly sticky: boolean; readonly share: number }> =>
  pane.evaluate((element) => ({
    sticky: getComputedStyle(element).position === 'sticky',
    share: element.getBoundingClientRect().height / window.innerHeight,
  }))

type App = Parameters<typeof joinAsGuest>[1]

/** What a host may change about an event, through the API exactly as the settings form does. */
interface EventSettings {
  readonly allowCaptions?: boolean
  readonly allowClips?: boolean
  readonly ambiance?: 'guinguette' | 'cabaret'
}

const applySettings = async (app: App, slug: string, settings: EventSettings): Promise<void> => {
  const api = await sessionOn(app.baseUrl)
  const login = await api.post('/api/auth/login', app.owner)
  if (!succeeded(login)) throw new Error(`the owner could not sign in: ${login.status}`)
  const { ambiance, ...flags } = settings
  const body = {
    ...flags,
    // The whole theme, because the route refuses a part of one (an old tab must not undo a choice).
    ...(ambiance === undefined
      ? {}
      : { theme: { accentHue: 305, fonts: 'sans', frame: 'soft', material: 'glass', ambiance } }),
  }
  const saved = await api.patch(`/api/events/${slug}/settings`, body)
  if (!succeeded(saved)) throw new Error(`the settings were refused: ${saved.status}`)
}

const openUploadScreen = async (
  page: Page,
  app: App,
  slug: string,
  settings: EventSettings = {},
): Promise<void> => {
  const event = await app.seedEvent({ slug, name: 'Les 40 ans de Sam' })
  if (Object.keys(settings).length > 0) await applySettings(app, event.slug, settings)
  await joinAsGuest(page, app, event.joinCode)
  await passPrivacyNotice(page)
}

for (const phone of PHONES) {
  test(`${phone.name}: after sending ${PHOTOS} photos, none of the guest's own photos is under the pane`, async ({
    app,
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: phone.width, height: phone.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      locale: SUITE_LOCALE,
      baseURL: app.baseUrl,
      // To set the text size from the outside. The page's own CSP is not under test here.
      bypassCSP: true,
    })
    const page = await context.newPage()
    const slug = `pane-${testInfo.workerIndex}-${phone.width}`
    await openUploadScreen(page, app, slug)
    if (phone.textSize !== 100) {
      await page.addStyleTag({ content: `html { font-size: ${phone.textSize}%; }` })
    }

    const photos = await Promise.all(
      Array.from({ length: PHOTOS }, (_unused, index) =>
        aPhoto(`pane-${phone.width}-${index + 1}`, 800, 600),
      ),
    )
    await page.getByTestId('photo-input').setInputFiles(photos)
    await page.getByRole('button', { name: /^Envoyer/i }).click()

    // They have all arrived, and the guest's own list says so: that list is the thing under test.
    // The queue has folded into its one line saying the same (`queue-summary` below is about it).
    await expect(page.getByText(fr.upload.queueDone(PHOTOS, 0))).toBeVisible()
    const mine = page.locator('li').filter({
      has: page.getByRole('img', { name: fr.upload.mineAlt }),
    })
    await expect(mine).toHaveCount(PHOTOS)

    const pane = page.getByTestId('upload-composer')

    // A pane taller than the screen is allowed, as long as it is not pinned: then it scrolls
    // like any other part of the page.
    const { sticky, share } = await pinnedShare(pane)
    if (sticky) expect(share).toBeLessThanOrEqual(MAX_PINNED_SHARE)

    for (let index = 0; index < PHOTOS; index += 1) {
      expect(await reachable(mine.nth(index)), `"Vos envois", photo ${index + 1}`).toBe(true)
    }

    // And the controls can still be reached: the picker is the top of the pane, and the send
    // button its bottom — a pane pinned taller than the screen loses the first of them.
    const picker = page.locator('label').filter({ has: page.getByTestId('photo-input') })
    expect(await reachable(picker), 'Ajouter des photos').toBe(true)
    expect(await reachable(page.getByRole('button', { name: /^Envoyer/i })), 'Envoyer').toBe(true)

    await context.close()
  })
}

test('a pane that fits the screen stays pinned to the bottom of it', async ({
  app,
  browser,
}, testInfo) => {
  // The other half of the rule: dropping the pane into the flow is for a pane that is too tall,
  // not for every pane. Tall enough here that the empty pane is well under the limit.
  const context = await browser.newContext({
    viewport: { width: 390, height: 1100 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: SUITE_LOCALE,
    baseURL: app.baseUrl,
  })
  const page = await context.newPage()
  await openUploadScreen(page, app, `pane-pinned-${testInfo.workerIndex}`)

  // `poll`: until the guest accepts it, the privacy notice is a card inside the pane, and a tall
  // one (an ambiance's display faces make it so) gets the pane measured as oversized. The pane
  // shrinks when the card goes and is pinned again at the next observation, a moment later.
  const pane = page.getByTestId('upload-composer')
  await expect.poll(async () => (await pinnedShare(pane)).sticky).toBe(true)
  expect((await pinnedShare(pane)).share).toBeLessThanOrEqual(MAX_PINNED_SHARE)

  await context.close()
})

test('picking the photos that make a pinned pane too tall does not take the send button off the screen', async ({
  app,
  browser,
}, testInfo) => {
  // Tall enough that the empty pane is pinned, short enough that three rows tip it over: the pane
  // then moves from the bottom edge of the screen to its place at the end of the page, and with
  // nobody scrolling it could land below the fold with the button in it. 780 and not the 900 it
  // was: the empty pane is a third shorter since the caption and the video are folded, so it takes
  // a shorter screen for three rows to tip it past the share.
  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: SUITE_LOCALE,
    baseURL: app.baseUrl,
  })
  const page = await context.newPage()
  await openUploadScreen(page, app, `pane-tip-${testInfo.workerIndex}`)
  const pane = page.getByTestId('upload-composer')
  // `poll`, for the reason the pinned test gives: the notice card leaves the pane first.
  await expect.poll(async () => (await pinnedShare(pane)).sticky).toBe(true)

  const photos = await Promise.all([1, 2, 3].map((index) => aPhoto(`pane-tip-${index}`, 800, 600)))
  await page.getByTestId('photo-input').setInputFiles(photos)

  await expect.poll(async () => (await pinnedShare(pane)).sticky).toBe(false)
  // Without a scroll of the test's own. `poll`: the page smooth-scrolls, so the button arrives a
  // moment after the pane has moved.
  const send = page.getByRole('button', { name: /^Envoyer/i })
  await expect
    .poll(() =>
      send.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return hit !== null && element.contains(hit)
      }),
    )
    .toBe(true)

  await context.close()
})

/**
 * The pane with nothing in it, which is what a guest sees first, and what it takes of the screen.
 *
 * Captions and video are both on by default in an event's settings, and each used to be shown in
 * full: the empty pane was 61 to 83% of a phone (82% of an iPhone SE), so it was never pinned on a
 * small one and a guest had to scroll to reach `Envoyer`. Both are labelled buttons now, folded
 * until pressed, and the pane holds to about two fifths of the screen. The share is a ceiling
 * rather than a layout: a restyle that stays under it moves nothing here, and a control put back
 * in full fails it.
 */
const EMPTY_PANES: readonly { readonly phone: Phone; readonly most: number }[] = [
  { phone: PHONES[0] as Phone, most: 0.4 },
  { phone: PHONES[1] as Phone, most: 0.42 },
]

for (const ambiance of ['guinguette', 'cabaret'] as const)
  for (const { phone, most } of EMPTY_PANES) {
    test(`${phone.name}, ${ambiance}: the empty pane takes at most ${most * 100}% of the screen, pinned, with the caption and video buttons on it`, async ({
      app,
      browser,
    }, testInfo) => {
      const context = await browser.newContext({
        viewport: { width: phone.width, height: phone.height },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        locale: SUITE_LOCALE,
        baseURL: app.baseUrl,
      })
      const page = await context.newPage()
      await openUploadScreen(page, app, `pane-empty-${testInfo.workerIndex}-${phone.width}`, {
        ambiance,
      })
      const pane = page.getByTestId('upload-composer')

      // `poll`: until the guest accepts it, the privacy notice is a card inside the pane.
      await expect.poll(async () => (await pinnedShare(pane)).share).toBeLessThanOrEqual(most)
      expect((await pinnedShare(pane)).sticky).toBe(true)

      // Nothing is hidden for the sake of it: the two options are words on the screen, in the
      // pane, without a scroll and without a menu.
      const caption = page.getByRole('button', { name: fr.upload.captionLabel, exact: true })
      const clip = page.getByRole('button', { name: fr.upload.clipSection, exact: true })
      await expect(caption).toBeInViewport()
      await expect(clip).toBeInViewport()
      await expect(page.getByRole('button', { name: /^Envoyer/i })).toBeInViewport()
      await expect(page.getByTestId('photo-input')).toBeAttached()
      expect(await reachable(caption), 'Légende').toBe(true)
      expect(await reachable(clip), 'Vidéo').toBe(true)

      // And one photo picked still leaves it a pinned pane, under the share the hook allows.
      await page.getByTestId('photo-input').setInputFiles(await aPhoto('pane-empty-one', 800, 600))
      await expect(page.getByTestId('upload-item-0')).toBeVisible()
      await expect.poll(async () => (await pinnedShare(pane)).sticky).toBe(true)
      expect((await pinnedShare(pane)).share).toBeLessThanOrEqual(MAX_PINNED_SHARE)

      await context.close()
    })
  }

test('the caption and the video unfold in place, with their hints, and stay reachable', async ({
  app,
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: SUITE_LOCALE,
    baseURL: app.baseUrl,
  })
  const page = await context.newPage()
  await openUploadScreen(page, app, `pane-unfold-${testInfo.workerIndex}`)
  const pane = page.getByTestId('upload-composer')
  await expect.poll(async () => (await pinnedShare(pane)).sticky).toBe(true)
  const folded = (await pinnedShare(pane)).share

  await page.getByRole('button', { name: fr.upload.captionLabel, exact: true }).click()
  await expect(page.getByLabel(fr.upload.captionLabel)).toBeFocused()
  await expect(page.getByText(fr.upload.captionHint(140))).toBeVisible()

  await page.getByRole('button', { name: fr.upload.clipSection, exact: true }).click()
  await expect(page.getByText(fr.upload.clipHint(15, 80))).toBeVisible()
  await expect(page.getByTestId('clip-input')).toBeFocused()

  // It grew: what unfolded is on the page and not behind it. And by more than a margin, so this
  // cannot pass on a pane that never changed.
  expect((await pinnedShare(pane)).share).toBeGreaterThan(folded + 0.1)
  expect(await reachable(page.getByLabel(fr.upload.captionLabel)), 'the caption field').toBe(true)
  expect(await reachable(page.getByRole('button', { name: /^Envoyer/i })), 'Envoyer').toBe(true)

  await context.close()
})

test('an event that allows neither captions nor video shows neither button', async ({
  app,
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    locale: SUITE_LOCALE,
    baseURL: app.baseUrl,
  })
  const page = await context.newPage()
  await openUploadScreen(page, app, `pane-none-${testInfo.workerIndex}`, {
    allowCaptions: false,
    allowClips: false,
  })

  await expect(page.getByRole('button', { name: /^Envoyer/i })).toBeVisible()
  await expect(page.getByRole('button', { name: fr.upload.captionLabel, exact: true })).toHaveCount(
    0,
  )
  await expect(page.getByRole('button', { name: fr.upload.clipSection, exact: true })).toHaveCount(
    0,
  )
  await expect(page.getByTestId('clip-input')).toHaveCount(0)

  await context.close()
})

/**
 * The narrowest phone with its text at 200%, and the page does not scroll sideways.
 *
 * A mobile browser answers a page wider than the screen by zooming it out until it fits, so the
 * guest would see the whole screen shrunk to a third. What was wider: the header's ghost buttons
 * (their label never wrapped), the two pickers (a `1fr` column is never narrower than its longest
 * word) and a queue row. Each wraps or stacks now, and nothing is hidden: every control is asked
 * for its own box, inside the screen.
 */
for (const ambiance of ['guinguette', 'cabaret'] as const)
  test(`320x568, text at 200%, ${ambiance}: nothing is wider than the screen, with both options open and a photo picked`, async ({
    app,
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 568 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      locale: SUITE_LOCALE,
      baseURL: app.baseUrl,
      bypassCSP: true,
    })
    const page = await context.newPage()
    await openUploadScreen(page, app, `pane-wide-${testInfo.workerIndex}-${ambiance}`, {
      ambiance,
    })
    await page.addStyleTag({ content: 'html { font-size: 200%; }' })

    const expectNoSidewaysScroll = async (when: string) => {
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      // `innerWidth` too: a mobile browser that zoomed out to fit has a wider layout viewport.
      expect(innerWidth, `${when}: the layout viewport`).toBe(320)
      expect(scrollWidth, `${when}: the page`).toBeLessThanOrEqual(innerWidth)
    }

    await expectNoSidewaysScroll('empty')

    // Every control of the header, in its own box and inside the screen.
    const headerControls = [
      page.getByLabel(fr.app.language),
      page.getByRole('link', { name: fr.feed.link }),
      page.getByRole('button', { name: fr.join.notYourEvening }),
      page.getByRole('button', { name: fr.upload.noticeLink }),
    ]
    for (const control of headerControls) {
      await expect(control).toBeVisible()
      const box = await control.boundingBox()
      expect(box, 'a header control has a box').not.toBeNull()
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320)
    }

    await page.getByRole('button', { name: fr.upload.captionLabel, exact: true }).click()
    await page.getByRole('button', { name: fr.upload.clipSection, exact: true }).click()
    await page.getByTestId('photo-input').setInputFiles(await aPhoto('pane-wide', 800, 600))
    await expect(page.getByTestId('upload-item-0')).toBeVisible()
    await expectNoSidewaysScroll('both options open, one photo picked')

    await context.close()
  })

test('320x568, text at 200%, in German: the longest word of the two buttons does not push the page wider', async ({
  app,
  browser,
}, testInfo) => {
  // "Bildunterschrift" is one word of sixteen letters: it has no space to wrap at, so it is the
  // case where letting a button's label wrap is not enough.
  const context = await browser.newContext({
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: SUITE_LOCALE,
    baseURL: app.baseUrl,
    bypassCSP: true,
  })
  const page = await context.newPage()
  await openUploadScreen(page, app, `pane-de-${testInfo.workerIndex}`)
  // The reader's own preference, as the language picker writes it, then a real reload.
  await page.evaluate(() => localStorage.setItem('eventslide.locale', 'de'))
  await page.reload()
  await page.addStyleTag({ content: 'html { font-size: 200%; }' })
  await expect(
    page.getByRole('button', { name: de.upload.captionLabel, exact: true }),
  ).toBeVisible()

  const widths = () =>
    page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
  expect((await widths()).scrollWidth, 'folded').toBeLessThanOrEqual(320)

  await page.getByRole('button', { name: de.upload.captionLabel, exact: true }).click()
  await page.getByRole('button', { name: de.upload.clipSection, exact: true }).click()
  const open = await widths()
  expect(open.innerWidth, 'the layout viewport').toBe(320)
  expect(open.scrollWidth, 'both options open').toBeLessThanOrEqual(320)

  await context.close()
})

/**
 * After a batch of seven photos has arrived, the queue is one line, and the guest is shown where
 * their photos went.
 *
 * Seven rows of "Envoyée" took the whole screen of a phone, and the guest never saw that their
 * photos had moved to "Vos envois" above: the rows said nothing about it, and the answer to
 * "did it work?" was out of sight. The rows fold into one line with a way to the list ("Voir mes
 * envois") and a disclosure that brings the rows back ("Détails"). What is asserted is geometry
 * (the share of the screen the pane takes, and what a touch at the middle of the first photo of
 * the batch would hit), never a pixel.
 *
 * A pane of one line and the picker is not the 40% of the *empty* pane: the line is a row of 44 px
 * targets on top of it. Half the screen is the ceiling here, against 1.0's 164% for six rows.
 */
const SUMMARY_PANE_MOST = 0.5

const BATCH = 7

for (const ambiance of ['guinguette', 'cabaret'] as const)
  test(`375x667, ${ambiance}: after ${BATCH} photos the pane is one line, and "Voir mes envois" brings the batch on screen`, async ({
    app,
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      locale: SUITE_LOCALE,
      baseURL: app.baseUrl,
    })
    const page = await context.newPage()
    await openUploadScreen(page, app, `pane-summary-${testInfo.workerIndex}-${ambiance}`, {
      ambiance,
    })
    const photos = await Promise.all(
      Array.from({ length: BATCH }, (_unused, index) =>
        aPhoto(`pane-summary-${index + 1}`, 800, 600),
      ),
    )
    await page.getByTestId('photo-input').setInputFiles(photos)
    // While photos are queued every row is shown, with its progress: the pane is the tall one.
    await expect(page.getByTestId(`upload-item-${BATCH - 1}`)).toBeVisible()
    await page.getByRole('button', { name: /^Envoyer/i }).click()

    // The rows keep their testid and their state (the contract the other journeys read) ...
    await expect(page.getByTestId(`upload-item-${BATCH - 1}`)).toHaveAttribute('data-state', 'done')
    // ... and the pane is one line.
    const pane = page.getByTestId('upload-composer')
    const summary = page.getByText(fr.upload.queueDone(BATCH, 0))
    await expect(summary).toBeVisible()
    await expect
      .poll(async () => (await pinnedShare(pane)).share)
      .toBeLessThanOrEqual(SUMMARY_PANE_MOST)
    expect(await summary.isVisible(), 'the summary line').toBe(true)
    // Folded rows are out of the screen and the accessibility tree, not out of the page.
    await expect(page.getByTestId('upload-item-0')).toBeHidden()
    await expect(page.getByRole('img', { name: fr.upload.itemAlt(1) })).toHaveCount(0)

    // "Vos envois" holds the batch, newest first.
    const mine = page.locator('li').filter({
      has: page.getByRole('img', { name: fr.upload.mineAlt }),
    })
    await expect(mine).toHaveCount(BATCH)
    const first = mine.first()

    // Not yet where a thumb would see it: the page is where the guest left it, at the bottom.
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }))

    await page.getByRole('button', { name: fr.upload.queueViewMine }).click()

    // The first photo of the batch is inside the screen, and what a touch at its middle reaches.
    // `poll`: the scroll is smooth.
    await expect
      .poll(() =>
        first.evaluate((element) => {
          const box = element.getBoundingClientRect()
          const x = box.left + box.width / 2
          const y = box.top + box.height / 2
          if (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth) return 'off screen'
          const hit = document.elementFromPoint(x, y)
          return hit !== null && element.contains(hit) ? 'reachable' : 'covered'
        }),
      )
      .toBe('reachable')
    // And it is the heading that has focus, so a screen reader reads on from "Vos envois".
    await expect(page.getByRole('heading', { level: 2, name: fr.upload.mine })).toBeFocused()

    // The rows are one press away, with the word of each state.
    const details = page.getByRole('button', { name: fr.upload.queueDetails })
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await details.click()
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('upload-item-0')).toBeVisible()

    await context.close()
  })

test('320x568, text at 200%: the summary line wraps, and nothing is wider than the screen', async ({
  app,
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: SUITE_LOCALE,
    baseURL: app.baseUrl,
    bypassCSP: true,
  })
  const page = await context.newPage()
  await openUploadScreen(page, app, `pane-summary-wide-${testInfo.workerIndex}`)
  await page.addStyleTag({ content: 'html { font-size: 200%; }' })
  await page
    .getByTestId('photo-input')
    .setInputFiles(
      await Promise.all([1, 2, 3].map((n) => aPhoto(`pane-summary-wide-${n}`, 800, 600))),
    )
  await page.getByRole('button', { name: /^Envoyer/i }).click()
  await expect(page.getByText(fr.upload.queueDone(3, 0))).toBeVisible()

  const widths = () =>
    page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
  const folded = await widths()
  expect(folded.innerWidth, 'the layout viewport').toBe(320)
  expect(folded.scrollWidth, 'folded').toBeLessThanOrEqual(320)

  // Every control of the line has its own box, inside the screen.
  for (const name of [fr.upload.queueViewMine, fr.upload.queueDetails, fr.upload.queueDismiss]) {
    const box = await page.getByRole('button', { name }).boundingBox()
    expect(box, name).not.toBeNull()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320)
  }

  await page.getByRole('button', { name: fr.upload.queueDetails }).click()
  expect((await widths()).scrollWidth, 'rows back').toBeLessThanOrEqual(320)

  await context.close()
})
