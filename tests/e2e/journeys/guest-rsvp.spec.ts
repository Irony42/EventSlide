import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import type { TestApp } from '../fixtures/startTestApp'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A guest answers on the invitation's page, and finds the answer again (spec 30, lot 1), through a
 * real server and real browsers.
 *
 * What no cheaper ring can answer: **does the token that opens a reply stay out of every address a
 * server could log?** It is created in one browser, kept in its `localStorage`, and reaches a second
 * device only in the **fragment** of the link, which the page reads and removes from the address
 * bar; no request ever carries it in a path or a query. The host, meanwhile, sees the reply and
 * never the token, and closing the replies shows the guest "closes" with no form.
 *
 * Only `chromium-desktop` runs this file; the phone engine has its own short one.
 */

const text = fr.rsvp.guest

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
})

interface HostReply {
  readonly name: string
  readonly answer: string
  readonly adults: number
  readonly kids: number
  readonly diet: string | null
  readonly source: string
}

const hostReplies = async (
  page: Page,
  app: TestApp,
  slug: string,
): Promise<{ readonly replies: readonly HostReply[]; readonly raw: string }> => {
  const response = await page.request.get(app.url(`/api/events/${slug}/rsvps`))
  const raw = await response.text()
  return { replies: (JSON.parse(raw) as { rsvps: HostReply[] }).rsvps, raw }
}

test('a guest answers, finds the reply again, changes it from another device by its link, then erases it', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-reponses')
  const headers = await csrfHeaders(host.request, app)
  const asked = await host.request.put(app.url(`/api/events/${event.slug}/rsvp-form`), {
    headers,
    data: { enabled: true },
  })
  expect(asked.status()).toBe(200)
  const inviteToken = url.split('/i/')[1] ?? ''

  // --- Device one: answer.
  const first = await browser.newContext({ locale: 'fr-FR' })
  const phone = await first.newPage()
  const second = await browser.newContext({ locale: 'fr-FR' })
  const laptop = await second.newPage()
  try {
    await phone.goto(url)
    await expect(phone.getByRole('heading', { name: text.title })).toBeVisible()
    await phone.getByRole('button', { name: text.yes }).click()
    await phone.getByLabel(new RegExp(text.nameLabel)).fill('Léa Martin')
    await phone.getByRole('button', { name: new RegExp(`${text.more}.*${text.adults}`) }).click()
    await phone.getByLabel(new RegExp(text.dietLabel)).fill('sans gluten')
    await phone.getByRole('button', { name: text.send }).click()
    await expect(phone.getByRole('heading', { name: text.doneYes('Léa') })).toBeVisible()
    await expect(phone.getByText('Vous venez · 2 personnes')).toBeVisible()

    // --- The host sees it, and the token is nowhere in what they are told.
    const { replies, raw } = await hostReplies(host, app, event.slug)
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({
      name: 'Léa Martin',
      answer: 'yes',
      adults: 2,
      kids: 0,
      diet: 'sans gluten',
      source: 'open',
    })
    const editToken = await phone.evaluate(
      (key) => JSON.parse(window.localStorage.getItem(key) ?? '{}').editToken as string,
      `eventslide.rsvp.${inviteToken}`,
    )
    expect(editToken.length).toBeGreaterThan(20)
    expect(raw).not.toContain(editToken)

    // --- The same device finds it again after a reload, with nothing asked.
    await phone.reload()
    await expect(phone.getByRole('heading', { name: text.doneYes('Léa') })).toBeVisible()
    await expect(phone.getByRole('button', { name: text.yes })).toHaveCount(0)

    // --- Device two, with no memory, opens the private link: the fragment is read, then gone.
    const requested: string[] = []
    laptop.on('request', (request) => requested.push(request.url()))
    await laptop.goto(`${url}#r=${editToken}`)
    await expect(laptop.getByRole('heading', { name: text.doneYes('Léa') })).toBeVisible()
    expect(laptop.url()).not.toContain('r=')
    expect(laptop.url()).not.toContain(editToken)
    // No request carried the token in an address: it travels in a header, and the fragment never leaves.
    expect(requested.filter((address) => address.includes(editToken))).toEqual([])
    // This device remembers it now: a plain reload, with no fragment, finds the reply.
    await laptop.goto(url)
    await expect(laptop.getByRole('heading', { name: text.doneYes('Léa') })).toBeVisible()

    // --- Change it from there: no.
    await laptop.getByRole('button', { name: text.edit }).click()
    await expect(laptop.getByLabel(new RegExp(text.nameLabel))).toHaveValue('Léa Martin')
    await laptop.getByRole('button', { name: text.no }).click()
    await laptop.getByRole('button', { name: text.save }).click()
    await expect(laptop.getByRole('heading', { name: text.doneNo('Léa') })).toBeVisible()
    const changed = await hostReplies(host, app, event.slug)
    expect(changed.replies[0]).toMatchObject({ answer: 'no', adults: 0, diet: null })

    // --- Erase it, with a question first.
    await laptop.getByRole('button', { name: text.delete }).click()
    await laptop
      .getByRole('alertdialog', { name: text.deleteAsk })
      .getByRole('button', { name: text.deleteYes })
      .click()
    await expect(laptop.getByText(text.deleted)).toBeVisible()
    expect((await hostReplies(host, app, event.slug)).replies).toEqual([])

    // --- The first device's token is dead now: it is told once, and asked again.
    await phone.reload()
    await expect(phone.getByText(text.forgotten.replace(' ', ' '))).toBeVisible()
    await expect(phone.getByRole('heading', { name: text.title })).toBeVisible()

    // --- The host closes the replies: the page says so, and offers no form.
    const closed = await host.request.post(app.url(`/api/events/${event.slug}/rsvp-form/close`), {
      headers,
      data: {},
    })
    expect(closed.status()).toBe(200)
    await phone.reload()
    await expect(phone.getByRole('heading', { name: text.closedTitle })).toBeVisible()
    await expect(phone.getByRole('button', { name: text.yes })).toHaveCount(0)
  } finally {
    await first.close()
    await second.close()
  }
})

test('the answering form fits a 320 px phone, its targets are 44 px and axe finds nothing serious', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'fete-reponses-etroite')
  const asked = await host.request.put(app.url(`/api/events/${event.slug}/rsvp-form`), {
    headers: await csrfHeaders(host.request, app),
    data: { enabled: true, deadline: '2027-12-01' },
  })
  expect(asked.status()).toBe(200)

  const context = await browser.newContext({
    locale: 'fr-FR',
    viewport: { width: 320, height: 640 },
  })
  const guest = await context.newPage()
  try {
    await guest.goto(url)
    await expect(guest.getByText(text.deadline('1 décembre'))).toBeVisible()
    await guest.getByRole('button', { name: text.yes }).click()
    await expect(guest.getByRole('button', { name: text.send })).toBeVisible()

    const overflow = await guest.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    for (const name of [text.yes, text.no, text.send]) {
      const box = await guest.getByRole('button', { name }).boundingBox()
      expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44)
    }
    const more = await guest
      .getByRole('button', { name: new RegExp(`${text.more}.*${text.adults}`) })
      .boundingBox()
    expect(more?.width ?? 0).toBeGreaterThanOrEqual(44)

    const { violations } = await new AxeBuilder({ page: guest })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    expect(violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([])
  } finally {
    await context.close()
  }
})
