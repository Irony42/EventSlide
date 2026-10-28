import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { rememberGuestSession } from '../lib/guestSession'
import { fr } from '../lib/i18n/fr'
import {
  aJoinResponse,
  aPrivacyNoticeState,
  aPublicEvent,
  fakeApi,
  renderWithProviders,
} from '../testing/renderWithProviders'
import { AppRoutes } from './router'

/**
 * Navigation pass, batch A: the guest's journeys through the real route table. What each
 * screen does alone is in its own test; what only the table can show is that a guest who
 * is sent to the code entry arrives back where they were heading, and that the installed
 * app's launch address ends on the event.
 */

const SLUG = 'camille-et-sacha'

const asInstalledApp = (): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('display-mode: standalone'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  )
}

const typeTheCode = async (): Promise<void> => {
  await userEvent.type(await screen.findByLabelText(fr.join.codeLabel), 'H7K2QM')
  await userEvent.click(screen.getByRole('button', { name: fr.join.submit }))
}

describe('a guest with no session is sent to the code entry and comes back (A2)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('returns to the feed when the guest came from the feed', async () => {
    renderWithProviders(<AppRoutes />, { route: `/e/${SLUG}/photos`, session: false })

    await userEvent.click(await screen.findByRole('link', { name: fr.upload.notJoinedAction }))
    await typeTheCode()

    expect(await screen.findByRole('heading', { level: 1, name: fr.feed.title })).toBeVisible()
  })

  it('returns to the upload screen when the guest came from it', async () => {
    renderWithProviders(<AppRoutes />, { route: `/e/${SLUG}/upload`, session: false })

    await userEvent.click(await screen.findByRole('link', { name: fr.upload.notJoinedAction }))
    await typeTheCode()

    expect(await screen.findByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
  })

  it('goes to the upload screen of the event the code opened, not to the feed they had a link to', async () => {
    const api = fakeApi({
      join: vi.fn(async () =>
        aJoinResponse({ event: aPublicEvent({ slug: 'gala', name: 'Gala' }) }),
      ),
    })
    renderWithProviders(<AppRoutes />, { api, route: `/e/${SLUG}/photos`, session: false })

    await userEvent.click(await screen.findByRole('link', { name: fr.upload.notJoinedAction }))
    await typeTheCode()

    expect(await screen.findByRole('heading', { level: 1, name: 'Gala' })).toBeVisible()
  })
})

describe('the installed app’s launch address (A1)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('opens the event the phone joined last, and the guest can say it is not theirs', async () => {
    rememberGuestSession({
      event: aPublicEvent({ name: 'Kermesse' }),
      displayName: 'Léa',
      privacyNotice: aPrivacyNoticeState(),
    })
    sessionStorage.clear()
    asInstalledApp()
    const api = fakeApi()

    renderWithProviders(<AppRoutes />, { api, route: '/join', session: false })

    expect(await screen.findByRole('heading', { level: 1, name: 'Kermesse' })).toBeVisible()
    expect(api.join).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: fr.join.notYourEvening }))

    expect(await screen.findByLabelText(fr.join.codeLabel)).toHaveValue('')
  })
})

describe('a link to another event, in the installed app', () => {
  it('reaches the code entry instead of being carried to the event the phone remembers', async () => {
    rememberGuestSession({
      event: aPublicEvent({ slug: 'kermesse', name: 'Kermesse' }),
      displayName: 'Léa',
      privacyNotice: aPrivacyNoticeState(),
    })
    sessionStorage.clear()
    asInstalledApp()

    renderWithProviders(<AppRoutes />, { route: `/e/${SLUG}/photos`, session: false })
    await userEvent.click(await screen.findByRole('link', { name: fr.upload.notJoinedAction }))

    expect(await screen.findByLabelText(fr.join.codeLabel)).toHaveValue('')
  })
})

describe('“À propos” from the code entry (A7)', () => {
  it('opens in the same tab, and Back returns to the code entry', async () => {
    renderWithProviders(<AppRoutes />, { route: '/join', session: false })

    await userEvent.click(await screen.findByRole('link', { name: fr.about.aboutLink }))
    await userEvent.click(await screen.findByRole('button', { name: fr.about.back }))

    expect(await screen.findByLabelText(fr.join.codeLabel)).toBeVisible()
  })
})
