import { expect, test } from '../fixtures/app'
import { aPhoto } from '../fixtures/media'

/**
 * The logo is asked for right after an event is created, while it is still easy to say.
 *
 * Only a real browser and a real server prove the whole path: the create form leads to the
 * welcome screen, the file crosses the same multipart route as the Apparence page's, and the
 * stored logo is what the event page then stops asking for.
 */
test('a host creates an event, sends the logo on the welcome screen and the event page stops asking', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  await host.goto(app.url('/admin/events/new'))
  await host.getByLabel('Nom de l’évènement').fill('Camille & Sacha')
  await host.getByRole('button', { name: 'Créer l’évènement' }).click()

  await host.waitForURL(/\/admin\/events\/camille-sacha\/welcome$/)
  await expect(host.getByRole('heading', { level: 1, name: /Camille & Sacha/ })).toBeVisible()
  // Nothing to continue with yet: the way out is the quiet one.
  await expect(host.getByRole('button', { name: 'Plus tard' })).toBeVisible()
  await expect(host.getByRole('button', { name: 'Continuer' })).toHaveCount(0)

  await host.getByTestId('logo-input').setInputFiles(await aPhoto('logo', 400, 400))
  await expect(host.getByRole('img', { name: 'Aperçu du logo de l’évènement' })).toBeVisible()
  await host.getByRole('button', { name: 'Continuer' }).click()

  await host.waitForURL(/\/admin\/events\/camille-sacha$/)
  await expect(host.getByRole('link', { name: 'Ajouter votre logo' })).toHaveCount(0)
  await expect(host.getByRole('link', { name: 'Imprimer les cartes de table' })).toBeVisible()
})

test('a host who leaves the welcome screen with « Plus tard » is reminded on the event page', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  await host.goto(app.url('/admin/events/new'))
  await host.getByLabel('Nom de l’évènement').fill('Noces de Jade')
  await host.getByRole('button', { name: 'Créer l’évènement' }).click()

  await host.getByRole('button', { name: 'Plus tard' }).click()

  await host.waitForURL(/\/admin\/events\/noces-de-jade$/)
  await expect(host.getByRole('link', { name: 'Ajouter votre logo' })).toHaveAttribute(
    'href',
    '/admin/events/noces-de-jade/appearance',
  )
})
