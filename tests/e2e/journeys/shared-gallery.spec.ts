import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { expect, test } from '../fixtures/app'
import { jpegWithLocation } from '../fixtures/media'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'

/**
 * The shared gallery link, from the host's laptop to a relative's browser (roadmap §4.1).
 *
 * What no cheaper ring can answer: **does a photograph a guest took with a phone — GPS
 * block and all — reach somebody who was never at the wedding, as a full-resolution file
 * with no coordinates in it, through a link the host made in the console?** Ring 4 proves
 * every refusal with fakes behind the server; this is the one run that crosses a real
 * multipart upload, `sharp`, SQLite, the signed media route and a real browser's download.
 *
 * The negatives are asserted with the positives: the photograph the host did not publish
 * is not in the album, the page tells crawlers and referrers nothing, and once the host
 * switches the link off the page and a URL lifted from it both stop working at once.
 */

const PASSWORD = 'les mariés de juin'

test('a host sends the album, a relative opens it with the password and downloads a clean original', async ({
  app,
  browser,
  surfaces,
}) => {
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'mariage-album', name: 'Camille & Sacha' })

  // --- A guest sends two photographs, both carrying the room's GPS coordinates.
  await guest.goto(app.url(`/join/${event.joinCode}`))
  await guest.getByRole('button', { name: /Rejoindre/i }).click()
  await guest.waitForURL(/\/e\/[^/]+\/upload/)
  await guest
    .getByTestId('photo-input')
    .setInputFiles([await jpegWithLocation('salle-une'), await jpegWithLocation('salle-deux')])
  await guest.getByRole('button', { name: /Envoyer/i }).click()
  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')
  await expect(guest.getByTestId('upload-item-1')).toHaveAttribute('data-state', 'done')

  // --- The host publishes one of them. The other stays pending, and must stay private.
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await expect(host.getByTestId('moderation-card')).toHaveCount(2)
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()
  await expect(host.getByTestId('moderation-card')).toHaveCount(1)

  // --- The host makes a password-protected link on the event page, and copies it.
  await host.goto(app.url(`/admin/events/${event.slug}`))
  const panel = host
    .locator('section')
    .filter({ has: host.getByRole('heading', { name: 'Album partagé' }) })
  await panel.getByLabel(/^Mot de passe/).fill(PASSWORD)
  await panel.getByRole('button', { name: 'Créer le lien' }).click()
  const address = panel.getByLabel('Adresse du lien')
  await expect(address).toHaveValue(new RegExp(`^${app.baseUrl}/g/[A-Za-z0-9_-]{43}$`))
  const url = await address.inputValue()
  await expect(panel.getByText('Protégé par un mot de passe')).toBeVisible()

  // --- A relative who was never there: a fresh browser, no cookie, no session.
  const relativeContext = await browser.newContext({ locale: SUITE_LOCALE })
  const relative = await relativeContext.newPage()
  try {
    const page = await relative.goto(url)
    // The page itself carries the gallery's headers: the token is in this address.
    expect(page?.headers()['x-robots-tag']).toBe('noindex, nofollow')
    expect(page?.headers()['referrer-policy']).toBe('no-referrer')
    expect(page?.headers()['cache-control']).toBe('no-store')
    await expect(relative.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    )

    // Nothing about the album before the password — not even whose wedding it is.
    await expect(relative.getByRole('heading', { name: 'Album protégé' })).toBeVisible()
    await expect(relative.getByText('Camille & Sacha')).toHaveCount(0)

    await relative.getByLabel('Mot de passe').fill(PASSWORD)
    await relative.getByRole('button', { name: 'Ouvrir l’album' }).click()

    // The published photograph, and only that one.
    await expect(relative.getByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
    await expect(relative.getByRole('button', { name: /Agrandir la photo/ })).toHaveCount(1)
    await expect(relative.getByText('1 photo', { exact: true })).toBeVisible()

    // --- The download: an attachment, named by the server, with no metadata left in it.
    await relative.getByRole('button', { name: 'Agrandir la photo 1' }).click()
    const downloadLink = relative.getByRole('link', { name: 'Télécharger l’original' })
    const href = await downloadLink.getAttribute('href')
    expect(href).not.toContain(url.split('/g/')[1] ?? 'the token')
    const [download] = await Promise.all([relative.waitForEvent('download'), downloadLink.click()])
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${event.slug}-[0-9a-f]+[.]jpg$`))

    const bytes = await readFile(await download.path())
    const metadata = await sharp(bytes).metadata()
    // The GPS IFD the phone wrote is gone, and so is the device's Make/Model block —
    // stripped on ingest, and this proves the stored original is what a stranger gets.
    expect(metadata.format).toBe('jpeg')
    expect(metadata.exif).toBeUndefined()
    expect(metadata.xmp).toBeUndefined()

    // --- The host switches the link off. The open page and a lifted URL both stop.
    await panel.getByRole('button', { name: 'Désactiver le lien' }).click()
    await host
      .getByRole('dialog', { name: 'Désactiver ce lien ?' })
      .getByRole('button', { name: 'Désactiver le lien' })
      .click()
    await expect(panel.getByText('Aucun lien n’est actif.')).toBeVisible()

    const lifted = await relative.request.get(app.url(href ?? '/'))
    expect(lifted.status()).toBe(404)

    await relative.reload()
    await expect(
      relative.getByRole('heading', { name: 'Ce lien n’est plus disponible' }),
    ).toBeVisible()
  } finally {
    await relativeContext.close()
  }
})
