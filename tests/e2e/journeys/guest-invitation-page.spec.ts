import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import type { APIRequestContext, Page } from '@playwright/test'
import { csrfHeaders, expect, test } from '../fixtures/app'
import type { TestApp } from '../fixtures/startTestApp'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The page a guest opens from an invitation, from the host's API call to the guest's browser (spec 29).
 *
 * What no cheaper ring can answer: **does the page follow the evening on a real server, with no
 * reload?** Draft: the details and the calendar, no way into the wall. The host opens the party:
 * the same open tab, when it comes back to the front, offers "Rejoindre le mur photo", which leads
 * to the join page of the moment. The host closes it: the date, "terminée", and **no address** (the
 * server stops sending it, so it cannot be on the page). The host changes the link: the old one is
 * one sentence, "plus disponible", and the new one works.
 *
 * The negatives are asserted with the positives: the page tells crawlers and referrers nothing,
 * a link in the host's word is not a link, and the join code is nowhere in the page before the
 * party is open.
 */

const PARTY = {
  title: 'Léa fête ses 40 ans',
  startsAt: '2027-12-11T18:00:00Z',
  endsAt: '2027-12-12T01:00:00Z',
  timeZone: 'Europe/Paris',
  venueName: 'La Guinguette du Port',
  address: '12 quai de la Loire\n44000 Nantes',
  message: 'Apéro à 19 h. Tout est sur https://exemple.test/programme, venez comme vous êtes.',
  language: 'fr',
}

interface Host {
  readonly api: APIRequestContext
  readonly app: TestApp
}

const call = async (
  host: Host,
  method: 'post' | 'put',
  path: string,
  data: unknown,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> => {
  const response = await host.api[method](host.app.url(path), {
    headers: await csrfHeaders(host.api, host.app),
    data,
  })
  return { status: response.status(), body: (await response.json().catch(() => ({}))) as never }
}

/** The link the host would send, from the answer of the API. */
const linkOf = (body: Record<string, unknown>): string => {
  const invite = body['guestInvite'] as { readonly url: string }
  return invite.url
}

/** A draft event of its own: the seeded events are opened, and an event cannot go back to a draft. */
const draftEvent = async (host: Host, slug: string) => {
  const created = await call(host, 'post', '/api/events', { name: PARTY.title, slug })
  expect(created.status).toBe(201)
  return created.body as { readonly slug: string; readonly joinCode: string }
}

const invite = async (host: Host, slug: string): Promise<string> => {
  const saved = await call(host, 'put', `/api/events/${slug}/guest-invite`, PARTY)
  expect(saved.status).toBe(200)
  const enabled = await call(host, 'post', `/api/events/${slug}/guest-invite/enable`, {})
  expect(enabled.status).toBe(200)
  return linkOf(enabled.body)
}

/** The tab comes back to the front: what a guest does after hours on another app. */
const returnToTheTab = async (page: Page): Promise<void> => {
  // The page re-reads at most every 15 s, so the guest has been away for 16.
  await page.clock.fastForward(16_000)
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
  })
}

test('the page follows the evening: details, then the way into the wall, then over without the address', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const hostApi: Host = { api: host.request, app }
  const event = await draftEvent(hostApi, 'fete-de-lea')
  const link = await invite(hostApi, event.slug)

  // --- A guest opens the link: a fresh browser, no cookie, no session.
  const context = await browser.newContext({ locale: 'fr-FR' })
  const guest = await context.newPage()
  await guest.clock.install()
  try {
    const response = await guest.goto(link)
    // The token is in this address: the shell carries the headers of every token page.
    expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow')
    expect(response?.headers()['referrer-policy']).toBe('no-referrer')
    expect(response?.headers()['cache-control']).toBe('no-store')
    // The button into the wall is a client-side link, so this document later hosts the join and
    // upload pages: it must keep the guest's microphone policy (spec 25), or a voice message
    // fails there without a word.
    expect(response?.headers()['permissions-policy']).toContain('microphone=(self)')

    await expect(guest.getByRole('heading', { level: 1, name: PARTY.title })).toBeVisible()
    await expect(guest.getByText(fr.guestInvite.page.when, { exact: true })).toBeVisible()
    await expect(guest.getByText('La Guinguette du Port')).toBeVisible()
    await expect(guest.getByText(/12 quai de la Loire/)).toBeVisible()
    await expect(guest.getByText('samedi 11 décembre 2027', { exact: false })).toBeVisible()
    await expect(guest.getByText('19 h – 2 h')).toBeVisible()
    await expect(guest.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    )
    // Before the party: the calendar, no way into the wall, and the join code is not in the page.
    await expect(guest.getByRole('button', { name: fr.guestInvite.page.agenda })).toBeVisible()
    await expect(guest.getByRole('link', { name: fr.guestInvite.page.join })).toHaveCount(0)
    expect(await guest.content()).not.toContain(event.joinCode)
    // The host's word is text: the link in it is not one.
    await expect(guest.getByText(/Tout est sur https:\/\/exemple.test\/programme/)).toBeVisible()
    await expect(guest.getByRole('link', { name: /exemple\.test/ })).toHaveCount(0)

    // --- "Ajouter à mon agenda": a real .ics, made in the browser.
    const download = guest.waitForEvent('download')
    await guest.getByRole('button', { name: fr.guestInvite.page.agenda }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('invitation.ics')
    const ics = await readFile(await file.path(), 'utf8')
    expect(ics).toContain('SUMMARY:Léa fête ses 40 ans')
    expect(ics).toContain('DTSTART:20271211T180000Z')
    expect(ics).toContain('DTEND:20271212T010000Z')
    // The link rides in the description, which is meant; the event's own name is a digest of the token.
    const token = link.split('/i/')[1] ?? '#'
    expect(ics.replace(/\r\n /g, '')).toContain(`/i/${token}`)
    expect(ics.split('\r\n').find((line) => line.startsWith('UID:'))).not.toContain(token)

    // --- The host opens the party. The open tab, when it comes back to the front, shows the way in.
    const opened = await call(hostApi, 'post', `/api/events/${event.slug}/status`, {
      status: 'live',
    })
    expect(opened.status).toBe(200)
    await returnToTheTab(guest)
    const join = guest.getByRole('link', { name: fr.guestInvite.page.join })
    await expect(join).toBeVisible()
    await expect(join).toHaveAttribute('href', `/join/${event.joinCode}`)
    await expect(guest.getByText(fr.guestInvite.page.live)).toBeVisible()

    // --- It leads to the wall's own door, with no other QR to look for.
    await join.click()
    await expect(guest).toHaveURL(new RegExp(`/join/${event.joinCode}$`))
    // Same document, so the policy it was loaded with still allows the microphone.
    const allowed = await guest.evaluate(() => {
      // Not in the DOM typings yet: Chromium's `document.featurePolicy`.
      const policy = (
        document as unknown as { featurePolicy?: { allowsFeature(name: string): boolean } }
      ).featurePolicy
      return policy?.allowsFeature('microphone')
    })
    expect(allowed).toBe(true)

    // --- The host closes it: the date and "terminée", and not a trace of the address or the word.
    await guest.goto(link)
    await expect(guest.getByRole('link', { name: fr.guestInvite.page.join })).toBeVisible()
    const closed = await call(hostApi, 'post', `/api/events/${event.slug}/status`, {
      status: 'closed',
    })
    expect(closed.status).toBe(200)
    await returnToTheTab(guest)
    await expect(guest.getByText(fr.guestInvite.page.over)).toBeVisible()
    await expect(guest.getByText('samedi 11 décembre 2027', { exact: false })).toBeVisible()
    await expect(guest.getByText(/quai de la Loire/)).toHaveCount(0)
    await expect(guest.getByText(/Tout est sur/)).toHaveCount(0)
    await expect(guest.getByRole('link', { name: fr.guestInvite.page.join })).toHaveCount(0)
    const body = await guest.content()
    expect(body).not.toContain('quai de la Loire')
    expect(body).not.toContain(event.joinCode)
  } finally {
    await context.close()
  }
})

test('changing the link leaves the old one a single sentence, and the new one works', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const hostApi: Host = { api: host.request, app }
  const event = await draftEvent(hostApi, 'fete-changee')
  const oldLink = await invite(hostApi, event.slug)

  const rotated = await call(hostApi, 'post', `/api/events/${event.slug}/guest-invite/rotate`, {})
  expect(rotated.status).toBe(200)
  const newLink = linkOf(rotated.body)
  expect(newLink).not.toBe(oldLink)

  const context = await browser.newContext({ locale: 'fr-FR' })
  const guest = await context.newPage()
  try {
    // The old link, and so a QR printed with it: one sentence, no title, no date, no place.
    await guest.goto(oldLink)
    await expect(
      guest.getByRole('heading', { level: 1, name: fr.guestInvite.page.gone }),
    ).toBeVisible()
    await expect(guest.getByText(PARTY.title)).toHaveCount(0)
    await expect(guest.getByText(/quai de la Loire/)).toHaveCount(0)

    await guest.goto(newLink)
    await expect(guest.getByRole('heading', { level: 1, name: PARTY.title })).toBeVisible()

    // Switched off, the same link says the same sentence as a link that never existed.
    const off = await call(hostApi, 'post', `/api/events/${event.slug}/guest-invite/disable`, {})
    expect(off.status).toBe(200)
    await guest.reload()
    await expect(
      guest.getByRole('heading', { level: 1, name: fr.guestInvite.page.gone }),
    ).toBeVisible()
    const nothing = await guest.request.get(app.url('/api/i/AAAAAAAAAAAAAAAA'))
    const gone = await guest.request.get(newLink.replace('/i/', '/api/i/'))
    expect(gone.status()).toBe(404)
    expect(await gone.json()).toEqual(await nothing.json())
  } finally {
    await context.close()
  }
})

test('the page fits a 320 px phone without a horizontal scrollbar, its buttons are targets and axe finds nothing serious', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const hostApi: Host = { api: host.request, app }
  const event = await draftEvent(hostApi, 'fete-etroite')
  const link = await invite(hostApi, event.slug)

  const context = await browser.newContext({
    locale: 'fr-FR',
    viewport: { width: 320, height: 640 },
  })
  const guest = await context.newPage()
  try {
    await guest.goto(link)
    await expect(guest.getByRole('heading', { level: 1, name: PARTY.title })).toBeVisible()

    const overflow = await guest.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    const agenda = guest.getByRole('button', { name: fr.guestInvite.page.agenda })
    await expect(agenda).toBeVisible()
    const button = await agenda.boundingBox()
    expect(button?.height ?? 0).toBeGreaterThanOrEqual(44)

    const { violations } = await new AxeBuilder({ page: guest })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    expect(violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([])
  } finally {
    await context.close()
  }
})
