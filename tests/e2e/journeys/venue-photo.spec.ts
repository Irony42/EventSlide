import sharp from 'sharp'
import { expect, test } from '../fixtures/app'
import { jpegWithOrientation } from '../fixtures/media'
import type { Locator, Page } from '@playwright/test'

/**
 * A host's own photograph of their venue, end to end (ADR 0010, decision 8): the host
 * uploads it on a laptop, the room and a guest's phone wear it, and it is what the stored
 * bytes say it is.
 *
 * It earns its seconds by crossing three surfaces and by what only a real browser can see:
 * that the inline custom property reaches a **pseudo-element's** background (jsdom computes
 * neither), that the root's bundled photograph is switched off in its favour, and that the
 * wall's `--wall-ground` picks the photograph up through `tokens.css` with no rule of its own.
 * Real `sharp` through a real multipart upload is the other half: the file a phone took carries
 * the venue's GPS position, and what is served back must not.
 */

const backgroundOf = (page: Page, selector: string, pseudo: string | null): Promise<string> =>
  page
    .locator(selector)
    .first()
    .evaluate((element, which) => getComputedStyle(element, which).backgroundImage, pseudo)

const chooseAmbiance = async (host: Page, slug: string, ambiance: string): Promise<void> => {
  await host.goto(`/admin/events/${slug}/settings`)
  await host.getByLabel('Ambiance').selectOption(ambiance)
  await host.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(host.getByText('Réglages enregistrés.')).toBeVisible()
}

const photoInput = (host: Page): Locator => host.getByTestId('venue-photo-input')

test('a host puts up a photograph of their venue and the room and a guest wear it', async ({
  app,
  surfaces,
}) => {
  const { host, projector, guest } = surfaces
  const event = await app.seedEvent({ slug: 'lieu-de-camille', name: 'Camille & Sacha' })

  // The product's own look, which carries no ambiance attribute at all: the photograph still
  // reaches it, because every ambiance (this one included) photographs its ground.
  await host.goto(`/admin/events/${event.slug}/settings`)
  await expect(photoInput(host)).toBeEnabled()

  // Before: the bundled photograph, on the wall and on the guest's welcome.
  await projector.goto(`/e/${event.slug}/display`)
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  expect(await backgroundOf(projector, '[data-testid="wall-empty"]', null)).toContain(
    'guinguette-ground',
  )

  // A phone photograph with a device name and a GPS block, sideways.
  await photoInput(host).setInputFiles(await jpegWithOrientation(6, { label: 'lieu' }))
  const preview = host.getByRole('img', { name: 'Aperçu de la photo de votre lieu' })
  await expect(preview).toBeVisible()
  const url = (await preview.getAttribute('src')) ?? ''
  expect(url).toMatch(new RegExp(`^/api/events/${event.slug}/venue-photo/[0-9a-f]{64}$`))

  // The room, loaded after the upload: its `--wall-ground` resolves the photograph through the
  // stylesheet with no rule of the wall's own. (A projector that is already running learns of it
  // only when `sameSettings` in `useWallPlaylist` compares `theme.groundUrl`, which lives in
  // the wall's own folder and is the follow-up recorded in the pull request.)
  await projector.reload()
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  expect(await backgroundOf(projector, '[data-testid="wall-empty"]', null)).toContain(
    '/venue-photo/',
  )
  expect(await backgroundOf(projector, '[data-testid="wall-empty"]', null)).not.toContain(
    'guinguette-ground-1600',
  )

  // The guest's welcome wears it on a fixed layer of its own, and the root's bundled one is off.
  await guest.goto(`/join/${event.joinCode}`)
  await expect(guest.locator('[data-venue-ground="guest"]')).toHaveCount(1)
  await expect(guest.locator('[data-venue-ground][data-event-ambiance]')).toHaveCount(0)
  expect(await backgroundOf(guest, '[data-venue-ground="guest"]', '::before')).toContain(
    '/venue-photo/',
  )
  expect(await backgroundOf(guest, 'html', '::before')).toBe('none')
  // Painted in the first render: nothing in the document is written to the root afterwards.
  expect(await guest.evaluate(() => document.documentElement.getAttribute('style'))).toBeNull()

  // The bytes: served to the room with no credential, WebP, and nothing of the phone left.
  const served = await projector.request.get(url)
  expect(served.status()).toBe(200)
  expect(served.headers()['content-type']).toBe('image/webp')
  const stored = await sharp(await served.body()).metadata()
  expect(stored.format).toBe('webp')
  expect(stored.exif).toBeUndefined()
  // Orientation was baked in, not carried: the fixture is 1200 x 600 with a rotation tag.
  expect(stored.width).toBeLessThan(stored.height ?? 0)
  expect((await served.body()).includes(Buffer.from('EventSlide E2E'))).toBe(false)

  // Taking it down: the bundled photograph is back everywhere and the URL is gone.
  await host.getByRole('button', { name: 'Revenir à la photo par défaut' }).click()
  await expect(host.getByText('Aucune photo de votre lieu', { exact: false })).toBeVisible()
  await projector.reload()
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  expect(await backgroundOf(projector, '[data-testid="wall-empty"]', null)).toContain(
    'guinguette-ground',
  )
  await guest.reload()
  await expect(guest.locator('[data-venue-ground]')).toHaveCount(0)
  expect(await backgroundOf(guest, 'html', '::before')).toContain('guinguette-ground')
  expect((await projector.request.get(url)).status()).toBe(404)
})

test('only a signed-in owner may put it up, and another event cannot read it', async ({
  app,
  surfaces,
}) => {
  const { host, projector } = surfaces
  const mine = await app.seedEvent({ slug: 'lieu-prive', name: 'Mariage' })
  const other = await app.seedEvent({ slug: 'lieu-voisin', name: 'Gala' })

  await host.goto(`/admin/events/${mine.slug}/settings`)
  await photoInput(host).setInputFiles(await jpegWithOrientation(6, { label: 'lieu-prive' }))
  const preview = host.getByRole('img', { name: 'Aperçu de la photo de votre lieu' })
  await expect(preview).toBeVisible()
  const digest = ((await preview.getAttribute('src')) ?? '').split('/').pop()

  // The other event, asked for this event's digest, answers as for nothing at all.
  const crossed = await projector.request.get(`/api/events/${other.slug}/venue-photo/${digest}`)
  expect(crossed.status()).toBe(404)
  expect((await crossed.json()).error.code).toBe('venuePhoto.notFound')

  // And an anonymous caller cannot write: the route is authorised before a byte is read.
  const anonymous = await projector.request.put(`/api/events/${mine.slug}/venue-photo`, {
    multipart: { photo: { name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') } },
  })
  expect([401, 403]).toContain(anonymous.status())
})

test('it follows the host through another ambiance, on the wall and on the phone', async ({
  app,
  surfaces,
}) => {
  const { host, projector, guest } = surfaces
  const event = await app.seedEvent({ slug: 'lieu-riviera', name: 'Camille & Sacha' })
  await chooseAmbiance(host, event.slug, 'riviera')
  await photoInput(host).setInputFiles(await jpegWithOrientation(1, { label: 'lieu-riviera' }))
  await expect(host.getByRole('img', { name: 'Aperçu de la photo de votre lieu' })).toBeVisible()

  await projector.goto(`/e/${event.slug}/display`)
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  const wall = await backgroundOf(projector, '[data-testid="wall-empty"]', null)
  expect(wall).toContain('/venue-photo/')
  expect(wall).not.toContain('riviera-ground')

  await guest.goto(`/join/${event.joinCode}`)
  await expect(
    guest.locator('[data-venue-ground="guest"][data-event-ambiance="riviera"]'),
  ).toHaveCount(1)
  expect(await backgroundOf(guest, '[data-venue-ground="guest"]', '::before')).toContain(
    '/venue-photo/',
  )
  expect(await backgroundOf(guest, 'html', '::before')).toBe('none')
})
