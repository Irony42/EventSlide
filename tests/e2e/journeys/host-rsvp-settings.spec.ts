import { expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host chooses what to ask the guests, on the Invitations page, and a guest sees it (spec 30,
 * lot 1, PR 4).
 *
 * What no cheaper ring can answer: **does a choice made in a panel with no Save button reach a real
 * server and then a guest's page, and does the host's preview say the same before it does?** The
 * host switches replies on, picks the wedding preset, sets a deadline, and the preview (an inert
 * phone frame) shows the form open on a "yes" with no "peut-être"; after a reload the choices are
 * the server's; a guest opening the link sees "Serez-vous là ?" with the deadline and two answers;
 * the host closes the replies and the guest page says so; the host reopens them.
 *
 * Only `chromium-desktop` runs it: the host's laptop is the surface.
 */

const asked = fr.rsvp.host
const guest = fr.rsvp.guest
const page = fr.guestInvite.host

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
})

test('the host switches replies on, chooses the form and a deadline, closes and reopens them; a guest sees each', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-reglages')
  const settingsUrl = app.url(`/api/events/${event.slug}/rsvp-form`)
  const stored = async () =>
    ((await (await host.request.get(settingsUrl)).json()) as { rsvpForm: Record<string, unknown> })
      .rsvpForm

  await host.goto(app.url(`/admin/events/${event.slug}/invitations?panel=reponses`))
  const panel = host.getByRole('region', { name: new RegExp(asked.title) })
  await expect(panel.getByRole('checkbox', { name: asked.askLabel })).not.toBeChecked()
  const frame = host.getByRole('group', { name: page.guestPreviewLabel })
  await expect(frame.getByRole('heading', { name: guest.title })).toHaveCount(0)

  // --- On, as a wedding, with a deadline: no save button, the preview follows at once.
  await panel.getByRole('checkbox', { name: asked.askLabel }).check()
  await expect(frame.getByRole('heading', { name: guest.title })).toBeVisible()
  await expect(frame.getByRole('button', { name: guest.maybe })).toBeVisible()
  await panel.getByRole('button', { name: /^Mariage/ }).click()
  await expect(frame.getByRole('button', { name: guest.maybe })).toHaveCount(0)
  await panel.getByLabel(new RegExp(asked.deadlineLabel)).fill('2027-12-01')
  await expect(panel.getByText(asked.saved)).toBeVisible()

  // --- What the server holds is what was chosen, and survives a reload.
  await expect.poll(async () => (await stored())['deadline']).toBe('2027-12-01')
  expect(await stored()).toMatchObject({
    enabled: true,
    form: { maybe: false, partySize: { enabled: true, max: 6 } },
    state: 'open',
  })
  await host.reload()
  const again = host.getByRole('region', { name: new RegExp(asked.title) })
  await expect(again.getByRole('checkbox', { name: asked.askLabel })).toBeChecked()
  await expect(again.getByRole('button', { name: /^Mariage/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(again.getByText(asked.stateOpen, { exact: true })).toBeVisible()

  // --- On the narrowest phone, the panel does not push the page sideways.
  const wide = host.viewportSize()
  await host.setViewportSize({ width: 320, height: 800 })
  await expect(again.getByRole('checkbox', { name: asked.askLabel })).toBeVisible()
  expect(
    await host.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)
  if (wide !== null) await host.setViewportSize(wide)

  // --- A guest opens the link: the block, the deadline, two answers, no "peut-être".
  const context = await browser.newContext({ locale: 'fr-FR' })
  const phone = await context.newPage()
  try {
    await phone.goto(url)
    await expect(phone.getByRole('heading', { name: guest.title })).toBeVisible()
    await expect(phone.getByText(guest.deadline('1 décembre'))).toBeVisible()
    await expect(phone.getByRole('button', { name: guest.yes })).toBeVisible()
    await expect(phone.getByRole('button', { name: guest.maybe })).toHaveCount(0)

    // --- The host closes the replies by hand: the guest's page says so.
    await again.getByRole('button', { name: asked.closeAction }).click()
    await expect(again.getByText(asked.stateClosed, { exact: true })).toBeVisible()
    await phone.reload()
    await expect(phone.getByRole('heading', { name: guest.closedTitle })).toBeVisible()
    await expect(phone.getByRole('button', { name: guest.yes })).toHaveCount(0)

    // --- And opens them again.
    await again.getByRole('button', { name: asked.reopenAction }).click()
    await expect(again.getByText(asked.stateOpen, { exact: true })).toBeVisible()
    await phone.reload()
    await expect(phone.getByRole('heading', { name: guest.title })).toBeVisible()
  } finally {
    await context.close()
  }
})
