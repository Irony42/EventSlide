import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { csrfHeaders, expect, signInAsHost, test, type Surfaces } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import type { TestApp } from '../fixtures/startTestApp'
import { readZip } from '../fixtures/zip'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * Export, then purge (spec 22), from the host's side and in a real browser.
 *
 * A guest sends a photograph, the host publishes it, keeps the album for thirty days and closes
 * the evening. The page then says when the album goes; the host asks for the verified archive,
 * the real worker writes and re-reads it, and the browser downloads it by a real download. The
 * file the browser saved is read as a stranger's unzip tool would read it, and its
 * `MANIFEST.sha256` is checked against the bytes of every entry, one by one.
 *
 * Only a real browser, a real worker and a real disk can say that these are wired: the rules
 * (what is verified, what withdraws an archive, what the band says) are held one ring down.
 */

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** What the page is waiting for from the real worker: behind any transcoding, so generous. */
const ARCHIVE_READY = { timeout: 60_000 }

/** The host publishes the one photograph, keeps the album 30 days and closes the evening. */
const closedAlbumWithOnePhoto = async (
  app: TestApp,
  { guest, host }: Surfaces,
  slug: string,
): Promise<{ slug: string; band: ReturnType<Page['locator']> }> => {
  const event = await app.seedEvent({ slug, name: 'Camille & Sacha' })
  await signInAsHost(host, app)

  const kept = await host.request.patch(app.url(`/api/events/${event.slug}/settings`), {
    data: { retentionDays: 30 },
    headers: await csrfHeaders(host.request, app),
  })
  expect(kept.status()).toBe(200)

  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa' })
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()
  await host.getByRole('button', { name: fr.moderation.filterPublished }).click()
  await expect(host.getByTestId('moderation-card')).toHaveCount(1)

  await host.goto(app.url(`/admin/events/${event.slug}`))
  // Live: the album is not on a clock, so nothing is said of a date.
  await expect(host.getByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
  await expect(host.getByRole('heading', { name: fr.exportPurge.title })).toHaveCount(0)
  await host.getByRole('button', { name: fr.admin.closeEvent }).click()

  const band = host.locator('section', {
    has: host.getByRole('heading', { name: fr.exportPurge.title }),
  })
  await expect(band).toBeVisible()
  return { slug: event.slug, band }
}

/** The page has no sideways scroll: the whole width is what the reader can reach. */
const hasNoHorizontalScroll = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('a host closes the evening, prepares the archive, downloads it, and its manifest says what is in it, byte for byte', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { slug, band } = await closedAlbumWithOnePhoto(app, surfaces, 'archive-hote')

  // --- The date, counted, with the way out beside it: nothing is deleted today.
  await expect(band).toContainText(/Cet album sera supprimé le .* \(dans 30 jours\)/u)
  await expect(band).toContainText(fr.exportPurge.downloadFirst)
  // The early deletion is there, reachable, and says what is missing instead of going grey in silence.
  const deleteNow = host.getByRole('button', { name: fr.exportPurge.deleteNow })
  await expect(deleteNow).toHaveAttribute('aria-disabled', 'true')
  await expect(host.getByText(fr.exportPurge.needsArchive)).toBeVisible()

  // --- The real worker writes it, re-reads it and seals it.
  await band.getByRole('button', { name: fr.exportPurge.prepare }).click()
  await expect(band.getByText(/Archive prête :/)).toBeVisible(ARCHIVE_READY)
  // Ready is not sent: the button still says what to do first.
  await expect(host.getByText(fr.exportPurge.needsDownload)).toBeVisible()
  const shown = (await band.getByText(/^[0-9a-f]{64}$/).textContent()) ?? ''

  // --- A real download, saved by the browser.
  const [download] = await Promise.all([
    host.waitForEvent('download'),
    band.getByRole('link', { name: fr.exportPurge.downloadArchive }).click(),
  ])
  expect(download.suggestedFilename()).toBe(`${slug}-album.zip`)
  const saved = await readFile(await download.path())
  expect(sha256(saved)).toBe(shown)

  // --- Read like a stranger's unzip tool: the manifest names every file, and every digest is true.
  const entries = readZip(saved)
  const manifest = entries.find((entry) => entry.name.endsWith('MANIFEST.sha256'))
  expect(manifest, 'the archive carries MANIFEST.sha256').toBeDefined()
  const folder = (manifest?.name ?? '').slice(0, -'MANIFEST.sha256'.length)
  const lines = (manifest?.data.toString('utf8') ?? '').trimEnd().split('\n')
  // The photograph and the guestbook text: whatever else the album holds is listed too.
  const files = entries.filter((entry) => entry !== manifest)
  expect(files.length).toBeGreaterThan(0)
  expect(lines.at(-1)).toBe('# missing: 0')
  expect(lines.slice(0, -1)).toEqual(
    files.map((entry) => `${sha256(entry.data)}  ${entry.name.slice(folder.length)}`),
  )

  // --- The server saw the last byte leave: sent, never "received". The page says so, and the
  // early deletion, which was switched off, is on.
  await expect
    .poll(async () => {
      const state = await host.request.get(app.url(`/api/events/${slug}/export`))
      return ((await state.json()) as { servedAt: string | null }).servedAt !== null
    })
    .toBe(true)
  await host.reload()
  await expect(band.getByText(/envoyée en entier/)).toBeVisible()
  await expect(band).not.toContainText(/reçue?\b/i)
  const nowOn = host.getByRole('button', { name: fr.exportPurge.deleteNow })
  await expect(nowOn).toBeVisible()
  await expect(nowOn).not.toHaveAttribute('aria-disabled')
})

test('a guest erases what they sent: the archive is withdrawn and no longer offered, on a phone as on a laptop', async ({
  app,
  surfaces,
}, testInfo) => {
  const { guest, host } = surfaces
  const { slug, band } = await closedAlbumWithOnePhoto(app, surfaces, 'archive-efface')

  // --- The host's phone: the whole band reads without a sideways scroll, whatever state it is in.
  await host.setViewportSize({ width: 375, height: 812 })
  expect(await hasNoHorizontalScroll(host)).toBe(true)

  await band.getByRole('button', { name: fr.exportPurge.prepare }).click()
  await expect(band.getByText(/Archive prête :/)).toBeVisible(ARCHIVE_READY)
  expect(await hasNoHorizontalScroll(host)).toBe(true)
  await testInfo.attach('band-ready-375px', {
    body: await band.screenshot(),
    contentType: 'image/png',
  })
  expect((await host.request.get(app.url(`/api/events/${slug}/export.zip`))).status()).toBe(200)

  // --- The guest, on their own phone, takes back everything they sent.
  await guest.reload()
  await guest.getByRole('button', { name: fr.upload.eraseOpen }).click()
  await guest
    .getByRole('dialog', { name: fr.upload.eraseTitle })
    .getByRole('button', { name: fr.upload.eraseConfirm })
    .click()
  await expect(guest.getByRole('heading', { name: fr.upload.eraseDoneTitle })).toBeVisible()

  // --- The archive that held them is withdrawn before the bytes go: the host's page is told by
  // the server, with no reload, and the file is no longer served.
  await expect(band.getByText(fr.exportPurge.retired)).toBeVisible()
  await expect(band.getByRole('link', { name: fr.exportPurge.downloadArchive })).toHaveCount(0)
  await expect(band.getByRole('button', { name: fr.exportPurge.rebuild })).toBeVisible()
  expect((await host.request.get(app.url(`/api/events/${slug}/export.zip`))).status()).toBe(404)
  expect(await hasNoHorizontalScroll(host)).toBe(true)
  await testInfo.attach('band-withdrawn-375px', {
    body: await band.screenshot(),
    contentType: 'image/png',
  })
})
