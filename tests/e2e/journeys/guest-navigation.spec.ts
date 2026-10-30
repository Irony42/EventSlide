import { expect, test } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { sessionOn, succeeded } from '../fixtures/session'
import { fr } from '../../../web/src/lib/i18n/fr'
import type { Page } from '@playwright/test'
import type { TestApp } from '../fixtures/startTestApp'

/**
 * Where a guest's phone takes them when they come back, and when the evening ends
 * (navigation pass, batch A: findings A1, A3).
 *
 * Two things only a real server and a real browser can answer. The first is that the installed
 * app, which opens `/join` in a tab that has no session, finds the event again from what the
 * device remembers: it needs a real cookie, a real `localStorage` and a second tab. The second
 * is what the server says about an event the host has closed and then archived, because the
 * screen's behaviour rests on those two answers being different (a closed evening still has its
 * wall; an archived one answers 404) and no fake can promise that.
 */

/**
 * Makes the page report that it runs from the home-screen icon.
 *
 * `display-mode: standalone` is decided by the browser from how it was launched, and a
 * Playwright page cannot be launched that way, so the one thing it is asked is answered.
 */
const asInstalledApp = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = (query: string): MediaQueryList => {
      const list = real(query)
      if (!query.includes('display-mode: standalone')) return list
      Object.defineProperty(list, 'matches', { get: () => true })
      return list
    }
  })
}

/** The host's own call, as the console makes it. */
const hostSetsStatus = async (
  app: TestApp,
  slug: string,
  status: 'closed' | 'archived',
): Promise<void> => {
  const api = await sessionOn(app.baseUrl)
  const login = await api.post('/api/auth/login', {
    email: app.owner.email,
    password: app.owner.password,
  })
  expect(succeeded(login)).toBe(true)
  const changed = await api.post(`/api/events/${slug}/status`, { status })
  expect(succeeded(changed), `setting ${status} answered ${changed.status}`).toBe(true)
}

test('the installed app reopens the event the phone joined, and lets the guest leave it @smoke', async ({
  app,
  surfaces,
}) => {
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'kermesse-icone', name: 'Kermesse de juin' })
  await joinAndUpload(guest, app, event.joinCode, { displayName: 'Léa' })

  // --- The guest's tab is gone. The icon opens `/join` in a fresh tab of the same phone:
  // same cookies and `localStorage`, no `sessionStorage`.
  const launched = await guest.context().newPage()
  await asInstalledApp(launched)
  const joinRequests: string[] = []
  launched.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/join')) {
      joinRequests.push(request.url())
    }
  })
  await launched.goto(app.url('/join'))

  await expect(launched).toHaveURL(new RegExp(`/e/${event.slug}/upload$`))
  await expect(launched.getByRole('heading', { level: 1, name: 'Kermesse de juin' })).toBeVisible()
  // Nothing was typed and nobody was joined again: the cookie the phone already holds is the guest.
  expect(joinRequests).toEqual([])

  // --- Not their evening: back to an empty code entry, and the next launch does not return.
  await launched.getByRole('button', { name: fr.join.notYourEvening }).click()
  await expect(launched).toHaveURL(/\/join$/)
  await expect(launched.getByLabel(fr.join.codeLabel)).toHaveValue('')

  const relaunched = await guest.context().newPage()
  await asInstalledApp(relaunched)
  await relaunched.goto(app.url('/join'))
  await expect(relaunched.getByLabel(fr.join.codeLabel)).toBeVisible()
  await expect(relaunched).toHaveURL(/\/join$/)
})

test('in an ordinary browser tab /join is still an empty code entry, whatever the phone remembers', async ({
  app,
  surfaces,
}) => {
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'kermesse-onglet', name: 'Kermesse de juin' })
  await joinAndUpload(guest, app, event.joinCode)

  const tab = await guest.context().newPage()
  await tab.goto(app.url('/join'))

  await expect(tab.getByLabel(fr.join.codeLabel)).toHaveValue('')
  await expect(tab.getByRole('link', { name: fr.join.organiserLink })).toHaveAttribute(
    'href',
    '/login',
  )
})

test('a closed evening keeps its feed, and an archived one says it is no longer on display without a retry', async ({
  app,
  surfaces,
}) => {
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'soiree-close', name: 'Soirée de clôture' })
  await joinAndUpload(guest, app, event.joinCode, { caption: 'La dernière photo' })

  // The host publishes it, so the room (and the feed) has something to show.
  const { host } = surfaces
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await host
    .getByTestId('moderation-card')
    .first()
    .getByRole('button', { name: /Publier/i })
    .click()
  await expect(host.getByTestId('moderation-card')).toHaveCount(0)

  // --- Closed: the wall is still served, so the feed is an ordinary feed, and the upload
  // screen says the evening takes no more photos while leaving the way to the feed.
  await hostSetsStatus(app, event.slug, 'closed')
  await guest.goto(app.url(`/e/${event.slug}/photos`))
  await expect(guest.getByRole('img').first()).toBeVisible()
  await expect(guest.getByText(fr.feed.unavailable)).toHaveCount(0)

  await guest.goto(app.url(`/e/${event.slug}/upload`))
  await expect(guest.getByText(fr.upload.endedTitle)).toBeVisible()
  await expect(guest.getByRole('link', { name: fr.feed.link })).toBeVisible()

  // --- Archived: the wall answers 404, which no retry can change.
  await hostSetsStatus(app, event.slug, 'archived')
  await guest.goto(app.url(`/e/${event.slug}/photos`))
  await expect(guest.getByRole('heading', { name: fr.feed.unavailable })).toBeVisible()
  await expect(guest.getByRole('button', { name: fr.app.retry })).toHaveCount(0)
  await expect(guest.getByRole('button', { name: fr.feed.refresh })).toHaveCount(0)
  await expect(guest.getByRole('link', { name: fr.feed.back })).toBeVisible()
})
