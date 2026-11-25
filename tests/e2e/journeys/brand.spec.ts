import { expect, test } from '../fixtures/app'
import { jpegWithLocation } from '../fixtures/media'
import { openAppearance, saved } from '../fixtures/settingsPage'

/**
 * Spec 03, PR 1, end to end: the host writes a welcome message on a laptop, and the guest's
 * phone and the empty wall show it, with no reload; then the host clears it and both lose it.
 *
 * What only a real browser and a real server prove: the message crosses the settings form, the
 * database, the join response and the wall response, and reaches a projector that is already
 * running over SSE, where `sameSettings` is what decides whether the refetch is kept.
 */
test('a host writes a welcome message and the guest and the empty wall show it', async ({
  app,
  surfaces,
}) => {
  const { host, guest, projector } = surfaces
  const event = await app.seedEvent({ slug: 'bienvenue', name: 'Camille & Sacha' })

  await projector.goto(app.url(`/e/${event.slug}/display`))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  await expect(projector.getByTestId('wall-welcome')).toHaveCount(0)

  await openAppearance(host, app.url(`/admin/events/${event.slug}/appearance`))
  // The welcome message is saved when the field loses focus, not per keystroke.
  await saved(host, async () => {
    await host
      .getByRole('textbox', { name: /Message d’accueil/ })
      .fill('Bienvenue !\nUne photo du gâteau ?')
    await host.getByRole('textbox', { name: /Message d’accueil/ }).press('Tab')
  })

  // No reload on the projector: the empty wall is where the host watches while they write.
  await expect(projector.getByTestId('wall-welcome')).toHaveText(
    /Bienvenue !\s*Une photo du gâteau \?/,
  )

  // The narrowest phone, so the button still being on screen is part of the claim.
  await guest.setViewportSize({ width: 320, height: 568 })
  await guest.goto(app.url(`/join/${event.joinCode}`))
  await expect(guest.getByTestId('host-greeting')).toContainText('Bienvenue !')
  await expect(guest.getByRole('button', { name: /Rejoindre/i })).toBeInViewport()

  await guest.getByRole('button', { name: /Rejoindre/i }).click()
  await guest.waitForURL(/\/e\/[^/]+\/upload/)
  await expect(guest.getByTestId('host-greeting')).toContainText('Une photo du gâteau')

  // The clear button saves at once (no blur needed).
  await saved(host, () => host.getByRole('button', { name: 'Effacer le message' }).click())

  await expect(projector.getByTestId('wall-welcome')).toHaveCount(0)
})

test('a host sends a logo: the preview is the stored file, location-free, and removal makes it a 404', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'logo-de-camille', name: 'Camille & Sacha' })

  await openAppearance(host, app.url(`/admin/events/${event.slug}/appearance`))
  // A phone picture with a device name and a GPS block: what the served bytes must not carry.
  await host.getByTestId('logo-input').setInputFiles(await jpegWithLocation('logo'))

  const preview = host.getByRole('img', { name: 'Aperçu du logo de l’évènement' })
  await expect(preview).toBeVisible()
  const url = (await preview.getAttribute('src')) ?? ''
  expect(url).toMatch(new RegExp(`^/api/events/${event.slug}/logo/[0-9a-f]{64}$`))

  const served = await host.request.get(app.url(url))
  expect(served.status()).toBe(200)
  expect(served.headers()['content-type']).toBe('image/webp')
  const bytes = await served.body()
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
  expect(bytes.includes(Buffer.from('Exif'))).toBe(false)
  expect(bytes.includes(Buffer.from('GPS'))).toBe(false)

  await host.getByRole('button', { name: 'Retirer le logo' }).click()
  await expect(preview).toBeHidden()
  expect((await host.request.get(app.url(url))).status()).toBe(404)
})

/**
 * Spec 03, PR 3: the logo reaches the guest's join page, and the empty wall of a projector that
 * is already running, with no reload; removing it takes it off both.
 */
test('a host sends a logo and the join page and the empty wall show it, then lose it', async ({
  app,
  surfaces,
}) => {
  const { host, guest, projector } = surfaces
  const event = await app.seedEvent({ slug: 'logo-affiche', name: 'Camille & Sacha' })

  await projector.goto(app.url(`/e/${event.slug}/display`))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  await expect(projector.getByTestId('host-logo')).toHaveCount(0)

  await openAppearance(host, app.url(`/admin/events/${event.slug}/appearance`))
  await host.getByTestId('logo-input').setInputFiles(await jpegWithLocation('logo'))
  await expect(host.getByRole('img', { name: 'Aperçu du logo de l’évènement' })).toBeVisible()

  const wallLogo = projector.getByRole('img', { name: 'Logo de Camille & Sacha' })
  await expect(wallLogo).toBeVisible()
  expect(await wallLogo.getAttribute('src')).toMatch(/\/logo\/[0-9a-f]{64}$/)

  await guest.setViewportSize({ width: 320, height: 568 })
  await guest.goto(app.url(`/join/${event.joinCode}`))
  await expect(guest.getByRole('img', { name: 'Logo de Camille & Sacha' })).toBeVisible()
  expect(
    await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true)

  await host.getByRole('button', { name: 'Retirer le logo' }).click()
  await expect(projector.getByTestId('host-logo')).toHaveCount(0)
})
