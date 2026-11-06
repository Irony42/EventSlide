import { expect, signInAsHost, test } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The photo book (spec 04): a guest uploads, the host publishes, asks for the book on the event
 * page, the real worker renders a real PDF, the host downloads it, and loses it when the photo
 * leaves the wall.
 *
 * It crosses a guest's phone and the host's laptop, runs the real worker and sharp over a real
 * upload, and the PDF is a real stream, which a component test cannot say.
 */

test('a host makes the photo book, downloads the PDF, and loses it when hiding a photo', async ({
  app,
  surfaces,
}) => {
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'mariage', name: 'Camille & Sacha' })
  await signInAsHost(host, app)

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
  // Nothing was asked for: the PDF is a single 404, never a download.
  expect((await host.request.get(app.url(`/api/events/${event.slug}/book.pdf`))).status()).toBe(404)

  const title = host.getByLabel(fr.admin.bookTitle, { exact: true })
  // The cover says the event's name until the host writes another: the name the server gave back,
  // which is not always the one asked for (a worker's server keeps its events across tests, and
  // `seedEvent` numbers a name whose slug is taken: "Camille & Sacha 2").
  await expect(title).toHaveValue(event.name)
  await host.getByRole('button', { name: fr.admin.bookCreate }).click()

  const download = host.getByRole('link', { name: fr.admin.bookDownload })
  await expect(download).toBeVisible({ timeout: 60_000 })

  const pdf = await host.request.get(app.url(`/api/events/${event.slug}/book.pdf`))
  expect(pdf.status()).toBe(200)
  expect(pdf.headers()['content-type']).toBe('application/pdf')
  expect(pdf.headers()['content-disposition']).toBe(
    `attachment; filename="${event.slug}-livre.pdf"`,
  )
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')

  // Taking the photo off the wall retires the book: the file is gone, not merely hidden.
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await host.getByRole('button', { name: fr.moderation.filterPublished }).click()
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Retirer de l.écran/i })
    .click()
  await expect
    .poll(async () =>
      (await host.request.get(app.url(`/api/events/${event.slug}/book.pdf`))).status(),
    )
    .toBe(404)

  await host.goto(app.url(`/admin/events/${event.slug}`))
  await expect(host.getByText(fr.admin.bookStale)).toBeVisible()
})
