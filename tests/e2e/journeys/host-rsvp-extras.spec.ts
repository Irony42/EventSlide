import { expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The lot 2 form (spec 30, PR 6): companions' first names, a menu per person and a question of the
 * host's own, from the host's panel to the guest's phone and back to the host's table and file.
 *
 * What no cheaper ring can answer: **does a question typed in a panel with no Save button get its
 * stable id on a real server, reach the guest's phone, and come back as a table column and a column
 * of the spreadsheet with the guest's answer in it?** The host switches the extras on and adds a
 * question; a guest on a phone answers "je viens" for two with a companion's name, a menu each and
 * the question; the host's page shows the three columns, the detail holds the answers; the file has
 * the same columns.
 *
 * Only `chromium-desktop` runs it: the host's laptop and a phone-sized context are enough.
 */

const asked = fr.rsvp.host
const guest = fr.rsvp.guest
const list = fr.rsvp.list
const page = fr.guestInvite.host

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
})

test('the host asks for companions, menus and a question; a guest answers them; the table and the file carry them', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-extras')

  await host.goto(app.url(`/admin/events/${event.slug}/invitations?panel=reponses`))
  const panel = host.getByRole('region', { name: new RegExp(asked.title) })
  await panel.getByRole('checkbox', { name: asked.askLabel }).check()
  await panel.locator('summary', { hasText: asked.groupMeals }).click()
  await panel.locator('summary', { hasText: asked.questionsTitle }).click()
  await panel.getByRole('checkbox', { name: asked.companionsLabel }).check()
  await panel.getByRole('checkbox', { name: asked.mealsLabel }).check()
  await panel.getByLabel(asked.mealsOptionsLabel).fill('Poisson\nVégé')
  await panel.getByLabel(asked.mealsOptionsLabel).blur()
  await panel.getByRole('button', { name: asked.questionAdd }).click()
  await panel.getByLabel(asked.questionLabelLabel, { exact: true }).fill('Un chant ?')
  await panel.getByRole('button', { name: asked.questionConfirm }).click()
  await expect(panel.getByText(asked.saved)).toBeVisible()
  // The question has its id from the server: its field is editable again.
  await expect(panel.getByLabel(asked.questionLabelLabel, { exact: true })).toBeEnabled()

  const stored = (await (
    await host.request.get(app.url(`/api/events/${event.slug}/rsvp-form`))
  ).json()) as {
    rsvpForm: { form: { questions: { id: string }[]; meals: { enabled: boolean } } }
  }
  expect(stored.rsvpForm.form.meals.enabled).toBe(true)
  expect(stored.rsvpForm.form.questions[0]?.id).toMatch(/^[0-9a-f]{8}$/)

  // --- A guest answers for two, on a phone.
  const context = await browser.newContext({
    locale: 'fr-FR',
    viewport: { width: 375, height: 800 },
  })
  const phone = await context.newPage()
  try {
    await phone.goto(url)
    await phone.getByRole('button', { name: guest.yes }).click()
    await phone.getByLabel(new RegExp(guest.nameLabel)).fill('Léa Martin')
    await phone.getByRole('button', { name: new RegExp(`${guest.more}.*${guest.adults}`) }).click()
    await phone.getByLabel(guest.companionLabel(1)).fill('Hugo')
    await phone.getByLabel(guest.mealFor('Léa')).selectOption('Poisson')
    await phone.getByLabel(guest.mealFor('Hugo')).selectOption('Végé')
    await phone.getByLabel(/Un chant/).fill('Le Temps des cerises')
    await phone.getByRole('button', { name: guest.send }).click()
    await expect(phone.getByRole('heading', { name: guest.doneYes('Léa') })).toBeVisible()
    await expect(phone.getByText(/Hugo/).first()).toBeVisible()
    await expect(phone.getByText(/Poisson, Végé/)).toBeVisible()
  } finally {
    await context.close()
  }

  // --- The host's table has the three columns, the detail the answers.
  await host.goto(app.url(`/admin/events/${event.slug}/rsvps`))
  const table = host.getByRole('table')
  for (const name of [list.colCompanions, list.colMeals, 'Un chant ?']) {
    await expect(table.getByRole('columnheader', { name })).toBeVisible()
  }
  const row = table.getByRole('row', { name: /Léa Martin/ })
  await expect(row).toContainText('Hugo')
  await expect(row).toContainText('Poisson, Végé')
  await expect(row).toContainText('Le Temps des cerises')

  // --- The spreadsheet: the same columns, the same answers.
  const download = host.waitForEvent('download')
  await host.getByRole('link', { name: list.export }).click()
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const csv = Buffer.concat(chunks).toString('utf8')
  const [header, line] = csv.slice(1).split('\r\n')
  expect(header).toContain('Accompagnants;Menus;')
  expect(header).toContain('Un chant ?')
  expect(line).toContain('Hugo;Poisson, Végé;')
  expect(line).toContain('Le Temps des cerises')
})
