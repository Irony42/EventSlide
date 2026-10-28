import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../lib/http'
import { AppRoutes } from './router'
import { de } from '../lib/i18n/de'
import { fr } from '../lib/i18n/fr'
import {
  aSessionUser,
  anEventDto,
  fakeApi,
  renderWithProviders,
} from '../testing/renderWithProviders'
import type { Api } from '../lib/api/client'
import type { EventDto, EventSummaryDto, SessionResponse } from '../lib/api/dto'
import type { Locale } from '../lib/i18n/locale'

/**
 * The way back from every host page under an event (ring 5, through the real route table).
 *
 * Surface: the host and the moderator. Pierre could not find how to create a second event
 * from an event's page: nothing on it led back to `/admin`, where "Nouvel évènement" is.
 */

const SLUG = 'camille-et-sacha'
const NAME = 'Camille & Sacha'

const summary: EventSummaryDto = {
  id: 'event-1',
  slug: SLUG,
  name: NAME,
  status: 'live',
  photoCount: 0,
  pendingCount: 0,
  guestCount: 0,
  usedBytes: 0,
  createdAt: '2026-06-20T21:04:11.031Z',
}

/** A signed-in account, the events it owns or moderates, and the one event's answer. */
const signedIn = (overrides: Partial<Api> = {}, user = aSessionUser()): Api =>
  fakeApi({
    session: vi.fn(async (): Promise<SessionResponse> => ({ authenticated: true, user })),
    listEvents: vi.fn(async () => ({ items: [summary] })),
    ...overrides,
  })

const at = (api: Api, route: string, locale: Locale = 'fr') =>
  renderWithProviders(<AppRoutes />, { api, route, session: false, locale })

const trail = async (locale: Locale = 'fr') =>
  screen.findByRole('navigation', { name: (locale === 'de' ? de : fr).admin.breadcrumbLabel })

const PAGES = [
  {
    page: 'the event page',
    route: `/admin/events/${SLUG}`,
    current: NAME,
    // The page's own name is the event, so the trail ends on it and has no second link.
    links: [[fr.admin.events, '/admin']],
  },
  {
    page: 'the moderation console',
    route: `/admin/events/${SLUG}/moderation`,
    current: fr.moderation.title,
    links: [
      [fr.admin.events, '/admin'],
      [NAME, `/admin/events/${SLUG}`],
    ],
  },
  {
    page: 'the settings page',
    route: `/admin/events/${SLUG}/settings`,
    current: fr.admin.settings,
    links: [
      [fr.admin.events, '/admin'],
      [NAME, `/admin/events/${SLUG}`],
    ],
  },
] as const

describe('the way back from an event page', () => {
  it.each(PAGES)(
    'offers $page a link to the list of events, and to the event where it is a sub-page',
    async ({ route, current, links }) => {
      at(signedIn(), route)

      const nav = await trail()
      // The name arrives with the event, a moment after the first link.
      await within(nav).findByText(current)

      const found = within(nav)
        .getAllByRole('link')
        .map((link) => [link.textContent?.replace('← ', ''), link.getAttribute('href')])
      expect(found).toEqual(links.map(([label, href]) => [label, href]))
      expect(within(nav).getByText(current)).toHaveAttribute('aria-current', 'page')
      // Marked once, and never on a link: the page you are on is not a control.
      expect(nav.querySelectorAll('[aria-current]')).toHaveLength(1)
    },
  )

  it('names the link "Vos évènements", with the arrow left out of what a screen reader says', async () => {
    at(signedIn(), `/admin/events/${SLUG}/moderation`)

    const link = within(await trail()).getByRole('link', { name: fr.admin.events })

    expect(link).toHaveAttribute('href', '/admin')
    expect(link.querySelector('[aria-hidden="true"]')).toHaveTextContent('←')
  })

  it('keeps the phone’s moderation screen to one short line: the way out and the event', async () => {
    at(signedIn(), `/admin/events/${SLUG}/moderation/mobile`)

    const nav = await trail()
    await within(nav).findByRole('link', { name: NAME })

    expect(within(nav).getByRole('link', { name: fr.admin.events })).toHaveAttribute(
      'href',
      '/admin',
    )
    expect(within(nav).getByRole('link', { name: NAME })).toHaveAttribute(
      'href',
      `/admin/events/${SLUG}`,
    )
    // The page's own heading, directly below, says where the host is.
    expect(within(nav).queryByText(fr.mobileModeration.title)).toBeNull()
    expect(screen.getByRole('heading', { name: fr.mobileModeration.title })).toBeVisible()
  })

  it('reads the trail in the host’s own language, and leaves the event’s name as it was written', async () => {
    at(signedIn(), `/admin/events/${SLUG}/settings`, 'de')

    const nav = await trail('de')

    expect(await within(nav).findByRole('link', { name: NAME })).toBeVisible()
    expect(within(nav).getByRole('link', { name: de.admin.events })).toBeVisible()
    expect(within(nav).getByText(de.admin.settings)).toBeVisible()
  })

  it('still offers the way out when the event could not be read', async () => {
    const api = signedIn({
      getEvent: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    at(api, `/admin/events/${SLUG}`)

    // The page itself is the failure, and the trail is what is left to leave it by.
    const nav = await trail()
    expect(within(nav).getByRole('link', { name: fr.admin.events })).toHaveAttribute(
      'href',
      '/admin',
    )
    // Nothing else: the page already failed to read the event, so the trail names no event, offers
    // no link to the very page that failed, and does not ask the network a second time.
    expect(within(nav).getAllByRole('link')).toHaveLength(1)
    expect(api.getEvent).toHaveBeenCalledTimes(1)
  })

  it('still offers the way out when the settings could not be read', async () => {
    const api = signedIn({
      getEvent: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    at(api, `/admin/events/${SLUG}/settings`)

    const nav = await trail()

    expect(within(nav).getByRole('link', { name: fr.admin.events })).toHaveAttribute(
      'href',
      '/admin',
    )
    expect(within(nav).getAllByRole('link')).toHaveLength(1)
    expect(api.getEvent).toHaveBeenCalledTimes(1)
  })

  it('leaves the settings page one link to the event: the trail is it, not a second one beside it', async () => {
    at(signedIn(), `/admin/events/${SLUG}/settings`)
    await within(await trail()).findByRole('link', { name: NAME })

    expect(screen.getAllByRole('link', { name: NAME })).toHaveLength(1)
  })

  it('still offers the event on the console when the name could not be read', async () => {
    const api = signedIn({
      getEvent: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    at(api, `/admin/events/${SLUG}/moderation`)

    const nav = await trail()

    expect(await within(nav).findByRole('link', { name: fr.titles.event })).toHaveAttribute(
      'href',
      `/admin/events/${SLUG}`,
    )
  })

  it('leads from an event page to the list that carries "Nouvel évènement"', async () => {
    at(signedIn(), `/admin/events/${SLUG}`)

    await userEvent.click(await within(await trail()).findByRole('link', { name: fr.admin.events }))

    expect(await screen.findByRole('heading', { name: fr.admin.events })).toBeVisible()
    expect(screen.getByRole('link', { name: fr.admin.newEvent })).toHaveAttribute(
      'href',
      '/admin/events/new',
    )
  })
})

describe('the way back for an account that only moderates', () => {
  /**
   * An invited moderator: no client, no authority over the box, and `moderator` on the one
   * event. Everything a link could lead them to is answered by the server's moderator-level
   * routes, so each link is followed rather than assumed.
   */
  const moderator = (): Api => {
    const asModerator: EventDto = anEventDto({ slug: SLUG, name: NAME, role: 'moderator' })
    return signedIn(
      { getEvent: vi.fn(async () => asModerator) },
      aSessionUser({ email: 'moderateur@example.org', canOperateSite: false }),
    )
  }

  it.each(PAGES)('links $page only to pages the account can open', async ({ route, links }) => {
    at(moderator(), route)

    const nav = await trail()
    await within(nav).findByRole('link', { name: fr.admin.events })

    // Never the operator's console nor the client's space: this account has neither.
    for (const link of within(nav).getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(new RegExp(`^/admin(/events/${SLUG})?$`))
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(links.length)
  })

  it('opens the list of events, holding the one event it moderates, from the console', async () => {
    at(moderator(), `/admin/events/${SLUG}/moderation`)

    await userEvent.click(await within(await trail()).findByRole('link', { name: fr.admin.events }))

    expect(await screen.findByRole('heading', { name: fr.admin.events })).toBeVisible()
    expect(await screen.findByRole('link', { name: NAME })).toHaveAttribute(
      'href',
      `/admin/events/${SLUG}`,
    )
  })

  it('opens the event from the settings page, read-only as the server makes it', async () => {
    at(moderator(), `/admin/events/${SLUG}/settings`)
    expect(await screen.findByText(fr.admin.settingsOwnerOnly)).toBeVisible()

    await userEvent.click(await within(await trail()).findByRole('link', { name: NAME }))

    expect(await screen.findByRole('heading', { name: NAME, level: 1 })).toBeVisible()
    // The owner's controls are not on it, so the link did not lead to a page of refusals.
    expect(screen.queryByRole('button', { name: fr.admin.purge })).toBeNull()
  })

  it('opens the event from the phone’s moderation screen', async () => {
    at(moderator(), `/admin/events/${SLUG}/moderation/mobile`)

    await userEvent.click(await within(await trail()).findByRole('link', { name: NAME }))

    await waitFor(() => expect(screen.getByRole('heading', { name: NAME, level: 1 })).toBeVisible())
  })
})
