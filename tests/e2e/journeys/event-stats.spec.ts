import { csrfHeaders, expect, joinAsGuest, signInAsHost, test } from '../fixtures/app'
import { passPrivacyNotice } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host's statistics page (spec 05), and the guest's erasure making it fall back to zero.
 *
 * One journey, because the figures are derived from the album: a guest on a phone sends two
 * files, the host refuses one on the moderation console, the page says two sends with one
 * refused, and when the guest erases what they sent the next read says zero. The ranking, the
 * slots and every state the event can be in are tested one ring down; this says the page is
 * wired to them, and fits a phone.
 */
test('the page counts what a guest sent, follows a refusal, and falls to zero after an erasure', async ({
  app,
  surfaces,
}) => {
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'statistiques', name: 'Camille & Sacha' })

  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))

  await joinAsGuest(guest, app, event.joinCode, 'Léa')
  await passPrivacyNotice(guest)
  await guest
    .getByTestId('photo-input')
    .setInputFiles([await aPhoto('stats-a', 1200, 900), await aPhoto('stats-b', 1100, 900)])
  await guest.getByRole('button', { name: /Envoyer/i }).click()
  await expect(guest.getByTestId('upload-item-1')).toHaveAttribute('data-state', 'done')

  await expect(host.getByTestId('moderation-card')).toHaveCount(2)
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: fr.moderation.reject })
    .click()
  await expect(host.getByTestId('moderation-card')).toHaveCount(1)

  // --- The page: two sends, one of them refused.
  await host.goto(app.url(`/admin/events/${event.slug}/stats`))
  await expect(host.getByRole('heading', { level: 1, name: fr.admin.stats.title })).toBeVisible()
  await expect(host.getByText(fr.admin.stats.figureUploads(2))).toBeVisible()
  await expect(host.getByText(fr.admin.stats.statusRejected)).toBeVisible()
  await expect(host.getByRole('table', { name: fr.admin.stats.timelineCaption })).toBeAttached()

  // --- A phone-sized screen never scrolls the page sideways.
  await host.setViewportSize({ width: 375, height: 800 })
  const overflow = await host.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  // --- The guest erases everything they sent: the next read has nothing to count.
  await guest.getByRole('button', { name: fr.upload.eraseOpen }).click()
  await guest
    .getByRole('dialog', { name: fr.upload.eraseTitle })
    .getByRole('button', { name: fr.upload.eraseConfirm })
    .click()
  await expect(guest.getByRole('heading', { name: fr.upload.eraseDoneTitle })).toBeVisible()

  await host.reload()
  await expect(host.getByText(fr.admin.stats.empty)).toBeVisible()
})

/**
 * After the party: opening the album link in a real browser counts one open, a link preview
 * counts nothing. A preview bot fetches the page's HTML and never runs its script, and the count
 * sits on the API call that only the page's script makes, so it is not counted **by construction**.
 */
test('a real browser opening the album link adds one open; fetching the page without its script adds none', async ({
  app,
  browser,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'statistiques-album', name: 'Camille & Sacha' })
  await signInAsHost(host, app)

  const created = await host.request.post(app.url(`/api/events/${event.slug}/share-link`), {
    headers: await csrfHeaders(host.request, app),
    data: {},
  })
  expect(created.status()).toBe(201)
  const { url } = (await created.json()) as { url: string }
  const stats = async () =>
    (
      (await (await host.request.get(app.url(`/api/events/${event.slug}/stats`))).json()) as {
        engagement: { galleryViews: number } | null
      }
    ).engagement

  expect(await stats()).toBeNull()

  // --- A link preview: the HTML, and nothing that runs.
  const preview = await host.request.get(url)
  expect(preview.status()).toBe(200)
  expect(await stats()).toBeNull()

  // --- A real browser, which runs the page and so asks the API for the album.
  const context = await browser.newContext()
  const visitor = await context.newPage()
  try {
    await visitor.goto(url)
    await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible()
  } finally {
    await context.close()
  }

  expect(await stats()).toMatchObject({ galleryViews: 1 })
  await host.goto(app.url(`/admin/events/${event.slug}/stats`))
  await expect(host.getByRole('heading', { level: 1, name: fr.admin.stats.title })).toBeVisible()
})
