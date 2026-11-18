import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { BrowserContext, Page } from '@playwright/test'
import { closeQuietly, csrfHeaders, expect, joinAsGuest, signInAsHost, test } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { jpegWithLocation, jpegWithOrientation } from '../fixtures/media'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
import type { TestApp } from '../fixtures/startTestApp'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A guest keeping another guest's photograph, from the feed on their own phone (spec 24).
 *
 * What no cheaper ring can say: that a photograph taken with a phone, GPS block and all, comes
 * out of a real multipart upload, `sharp`, SQLite, the guest's cookie and a real browser's
 * download as a file that is a JPEG, carries no coordinates, and is smaller than the original
 * the host holds. Ring 4 proves every refusal behind the server with fakes; this is the one run
 * where the chain closes, and where the host's levers are seen from the phone that is holding
 * the feed open.
 *
 * **What it does not say.** Playwright's WebKit cannot emulate iOS's share sheet, so on
 * `webkit-mobile` the journey asserts that the button exists and answers a tap, and never what
 * the sheet did: that is measured by hand on a real iPhone (docs/TESTING.md, "Appareils réels").
 * Everywhere else the phone is a download device, and the file is read byte by byte.
 */

const PHONE = { width: 390, height: 844 }

/** The save button of the one photograph on screen, by its visible word. */
const saveButton = (page: Page) =>
  page.getByRole('button', { name: new RegExp(`^${fr.app.save}`, 'u') })

/** A second phone, its own cookie jar, on the feed of the evening. */
const openFeedOnAnotherPhone = async (
  context: BrowserContext,
  app: TestApp,
  joinCode: string,
): Promise<Page> => {
  const reader = await context.newPage()
  await joinAsGuest(reader, app, joinCode, 'Sacha')
  await reader.getByRole('link', { name: fr.feed.link }).click()
  await expect(reader.getByRole('heading', { level: 1, name: fr.feed.title })).toBeVisible()
  await expect(reader.getByRole('img')).toBeVisible()
  return reader
}

const savePath = (slug: string, photoId: string): string =>
  `/api/events/${slug}/photos/${photoId}/save`

test('a guest saves another guest’s photo as a clean, smaller file; the host’s cut and removal reach the open feed', async ({
  app,
  surfaces,
  browser,
}, testInfo) => {
  const { guest: author, host } = surfaces
  const event = await app.seedEvent({ slug: 'enregistrer', name: 'Camille & Sacha' })

  // --- One guest sends a photograph with GPS in it; the host publishes it.
  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(author, app, event.joinCode, {
    displayName: 'Léa',
    // Wider than the display rendition's 2560 px, with GPS and a device block in it: the saved file is
    // the resized rendition, so it is smaller than the original, and it has lost both.
    file: await jpegWithOrientation(1, { label: 'enregistrer', width: 4000, height: 3000 }),
  })
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()

  const readerContext = await browser.newContext({
    viewport: PHONE,
    baseURL: app.baseUrl,
    locale: SUITE_LOCALE,
    // The phone project's device, so a touch screen: what a guest actually holds.
    hasTouch: true,
  })
  try {
    const reader = await openFeedOnAnotherPhone(readerContext, app, event.joinCode)
    const button = saveButton(reader)
    await expect(button).toBeVisible()
    await expect(button).toBeEnabled()

    // The author's own copy of the page offers them nothing under their own photograph.
    await author.goto(app.url(`/e/${event.slug}/photos`))
    await expect(author.getByRole('img')).toBeVisible()
    await expect(author.getByText(fr.feed.own, { exact: true })).toBeVisible()
    await expect(saveButton(author)).toHaveCount(0)

    // No sideways scroll on a phone, with the button on the card.
    await reader.setViewportSize({ width: 375, height: 800 })
    const overflow = await reader.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    const photoId = (await reader.getByRole('img').getAttribute('src'))?.split('/').at(-2) ?? ''
    expect(photoId).not.toBe('')

    if (testInfo.project.name === 'webkit-mobile') {
      // The button answers a tap and lets go of the guest; what a share sheet does is not here.
      await button.click()
      await expect(button).toBeEnabled()
    } else {
      // --- The tap: the browser's own download, not a copy in the page.
      const [download] = await Promise.all([reader.waitForEvent('download'), button.click()])
      expect(download.suggestedFilename()).toMatch(new RegExp(`^${event.slug}-[0-9a-f]+[.]jpg$`))
      await expect(reader.getByText(fr.feed.saveDownloaded)).toBeVisible()

      // --- The file is read: a JPEG, no coordinates, no device block, and the display
      // rendition, which is smaller than the original only the host may read.
      const saved = await readFile(await download.path())
      const metadata = await sharp(saved).metadata()
      expect(metadata.format).toBe('jpeg')
      expect(metadata.exif).toBeUndefined()
      expect(metadata.xmp).toBeUndefined()

      const original = await host.request.get(
        app.url(`/api/events/${event.slug}/photos/${photoId}/original`),
      )
      expect(original.status()).toBe(200)
      expect(saved.length).toBeLessThan((await original.body()).length)
    }

    // --- The address is a capability of the cookie, not of the page: nobody else's phone,
    // and no phone with no cookie, can use it.
    const stranger = await browser.newContext({ baseURL: app.baseUrl })
    try {
      expect((await stranger.request.get(app.url(savePath(event.slug, photoId)))).status()).toBe(
        401,
      )
    } finally {
      await closeQuietly(stranger)
    }

    // --- The host reads one number on the statistics page: the granted requests so far, and no
    // refusal (the stranger's 401 above) in it. An integer, with nobody's name beside it.
    const savesNow = async (): Promise<number | null> => {
      const response = await host.request.get(app.url(`/api/events/${event.slug}/stats`))
      const body = (await response.json()) as { engagement: { guestSaves: number } | null }
      return body.engagement?.guestSaves ?? null
    }
    const savesBefore = await savesNow()
    expect(savesBefore).toBe(1)

    // --- The host cuts it while the feed is open. The buttons stay (the feed has no live
    // channel) until the next tap, and then they go once, with one sentence: the route is
    // the door, and the page learns it there.
    const cut = await host.request.patch(app.url(`/api/events/${event.slug}/settings`), {
      data: { allowGuestSave: false },
      headers: await csrfHeaders(host.request, app),
    })
    expect(cut.status()).toBe(200)
    await expect(button).toBeVisible()

    const refused = await reader.request.get(app.url(savePath(event.slug, photoId)))
    expect(refused.status()).toBe(403)
    expect(await refused.json()).toMatchObject({ error: { code: 'save.disabled' } })
    expect(await savesNow()).toBe(savesBefore)

    await button.click()
    await expect(reader.getByText(fr.feed.saveDisabled)).toBeVisible()
    await expect(saveButton(reader)).toHaveCount(0)

    // --- A reload reads the wall again: still no button, and nothing to explain.
    await reader.reload()
    await expect(reader.getByRole('img')).toBeVisible()
    await expect(saveButton(reader)).toHaveCount(0)
    await expect(reader.getByText(fr.feed.saveDisabled)).toHaveCount(0)

    // --- The host switches it on again, then takes the photograph off the wall: the next
    // request is a 404 identical to a photograph that never existed.
    const restored = await host.request.patch(app.url(`/api/events/${event.slug}/settings`), {
      data: { allowGuestSave: true },
      headers: await csrfHeaders(host.request, app),
    })
    expect(restored.status()).toBe(200)
    const hidden = await host.request.patch(
      app.url(`/api/events/${event.slug}/photos/${photoId}/status`),
      { data: { decision: 'hide' }, headers: await csrfHeaders(host.request, app) },
    )
    expect(hidden.status()).toBeLessThan(300)

    const gone = await reader.request.get(app.url(savePath(event.slug, photoId)))
    expect(gone.status()).toBe(404)
    expect(await gone.json()).toMatchObject({ error: { code: 'photo.notFound' } })
  } finally {
    await closeQuietly(readerContext)
  }
})

test('a guest who erases what they sent takes the photograph out of everyone’s reach', async ({
  app,
  surfaces,
  browser,
}) => {
  const { guest: author, host } = surfaces
  const event = await app.seedEvent({ slug: 'enregistrer-effacement', name: 'Camille & Sacha' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(author, app, event.joinCode, {
    displayName: 'Léa',
    file: await jpegWithLocation('enregistrer-effacement'),
  })
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()

  const readerContext = await browser.newContext({
    viewport: PHONE,
    baseURL: app.baseUrl,
    locale: SUITE_LOCALE,
  })
  try {
    const reader = await openFeedOnAnotherPhone(readerContext, app, event.joinCode)
    const photoId = (await reader.getByRole('img').getAttribute('src'))?.split('/').at(-2) ?? ''
    expect(photoId).not.toBe('')
    const before = await reader.request.get(app.url(savePath(event.slug, photoId)))
    expect(before.status()).toBe(200)

    const erased = await author.request.delete(app.url(`/api/events/${event.slug}/guests/me`), {
      headers: await csrfHeaders(author.request, app),
    })
    expect(erased.status()).toBe(200)

    const after = await reader.request.get(app.url(savePath(event.slug, photoId)))
    expect(after.status()).toBe(404)
  } finally {
    await closeQuietly(readerContext)
  }
})

test('on an evening that is over, a guest whose access has lapsed has no button and is told to ask for the album link', async ({
  app,
  surfaces,
  browser,
}) => {
  const { guest: author, host } = surfaces
  const event = await app.seedEvent({ slug: 'enregistrer-termine', name: 'Camille & Sacha' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await joinAndUpload(author, app, event.joinCode, {
    displayName: 'Léa',
    file: await jpegWithLocation('enregistrer-termine'),
  })
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()

  const readerContext = await browser.newContext({
    viewport: PHONE,
    baseURL: app.baseUrl,
    locale: SUITE_LOCALE,
  })
  try {
    const reader = await openFeedOnAnotherPhone(readerContext, app, event.joinCode)
    await expect(saveButton(reader)).toBeVisible()

    // The evening ends, and the guest's access lapses: the device keeps its copy of the join
    // (a bookmark, a tab left open) and the server stops recognising it, which is what a token
    // older than 36 hours looks like from the phone.
    const ended = await host.request.post(app.url(`/api/events/${event.slug}/status`), {
      data: { status: 'closed' },
      headers: await csrfHeaders(host.request, app),
    })
    expect(ended.status()).toBeLessThan(300)
    await readerContext.clearCookies()

    await reader.reload()
    await expect(reader.getByRole('img')).toBeVisible()
    await expect(saveButton(reader)).toHaveCount(0)
    await expect(reader.getByText(fr.feed.saveExpiredClosed)).toBeVisible()
    await expect(reader.getByText(fr.feed.saveExpiredOpen)).toHaveCount(0)
  } finally {
    await closeQuietly(readerContext)
  }
})
