import { expect, test } from '../fixtures/app'

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

  await host.goto(app.url(`/admin/events/${event.slug}/settings`))
  await host.getByLabel(/Message d’accueil/).fill('Bienvenue !\nUne photo du gâteau ?')
  await host.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(host.getByText('Réglages enregistrés.')).toBeVisible()

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

  await host.getByRole('button', { name: 'Effacer le message' }).click()
  await host.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(host.getByText('Réglages enregistrés.').last()).toBeVisible()

  await expect(projector.getByTestId('wall-welcome')).toHaveCount(0)
})
