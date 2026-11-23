import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A guest answers on a phone (spec 30, lot 1): the engine that decides whether the page works
 * where the guests are. Short on purpose, the desktop run holds the journey: answer with a thumb,
 * see the confirmation, and **find it again after a reload**, which is `localStorage` and the CSRF
 * cookie under WebKit's own rules.
 *
 * Only `webkit-mobile` runs it.
 */

const text = fr.rsvp.guest

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit-mobile', 'the phone engine run')
})

test('a guest answers on a phone and finds the answer again after a reload', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-reponses-mobile')
  const asked = await host.request.put(app.url(`/api/events/${event.slug}/rsvp-form`), {
    headers: await csrfHeaders(host.request, app),
    data: { enabled: true },
  })
  expect(asked.status()).toBe(200)

  const context = await browser.newContext({ locale: 'fr-FR' })
  const guest = await context.newPage()
  try {
    await guest.goto(url)
    await guest.getByRole('button', { name: text.maybe }).click()
    await guest.getByLabel(new RegExp(text.nameLabel)).fill('Hugo Roux')
    await guest.getByRole('button', { name: text.send }).click()
    await expect(guest.getByRole('heading', { name: text.doneMaybe })).toBeVisible()

    await guest.reload()
    await expect(guest.getByRole('heading', { name: text.doneMaybe })).toBeVisible()
    await expect(guest.getByRole('button', { name: text.edit })).toBeVisible()

    const listed = await host.request.get(app.url(`/api/events/${event.slug}/rsvps`))
    const { rsvps } = (await listed.json()) as { rsvps: { name: string; answer: string }[] }
    expect(rsvps).toMatchObject([{ name: 'Hugo Roux', answer: 'maybe' }])
  } finally {
    await context.close()
  }
})
