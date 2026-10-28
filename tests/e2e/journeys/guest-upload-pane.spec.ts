import type { Locator, Page } from '@playwright/test'
import { expect, joinAsGuest, test } from '../fixtures/app'
import { passPrivacyNotice } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
import { fr } from '../../../web/src/lib/i18n/fr'

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

const openUploadScreen = async (
  page: Page,
  app: Parameters<typeof joinAsGuest>[1],
  slug: string,
): Promise<void> => {
  const event = await app.seedEvent({ slug, name: 'Les 40 ans de Sam' })
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
      // Not `isMobile` at 200%: a mobile browser zooms a page out to fit whatever overflows its
      // width, and the header's ghost buttons do overflow at that text size (a separate defect),
      // which would turn this into a measurement of the zoom rather than of the pane.
      isMobile: phone.textSize === 100,
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
    await expect(page.getByText(fr.upload.thanks)).toBeVisible()
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

  const { sticky, share } = await pinnedShare(page.getByTestId('upload-composer'))
  expect(share).toBeLessThanOrEqual(MAX_PINNED_SHARE)
  expect(sticky).toBe(true)

  await context.close()
})

test('picking the photos that make a pinned pane too tall does not take the send button off the screen', async ({
  app,
  browser,
}, testInfo) => {
  // Tall enough that the empty pane is pinned, short enough that three rows tip it over: the pane
  // then moves from the bottom edge of the screen to its place at the end of the page, and with
  // nobody scrolling it could land below the fold with the button in it.
  const context = await browser.newContext({
    viewport: { width: 390, height: 900 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: SUITE_LOCALE,
    baseURL: app.baseUrl,
  })
  const page = await context.newPage()
  await openUploadScreen(page, app, `pane-tip-${testInfo.workerIndex}`)
  const pane = page.getByTestId('upload-composer')
  expect((await pinnedShare(pane)).sticky).toBe(true)

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
