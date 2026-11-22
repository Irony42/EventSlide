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
  role: 'owner',
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

/** The menu beside every page of an event but the console (eventLayout/): the way back is in it. */
const menu = async (locale: Locale = 'fr') =>
  screen.findByRole('navigation', { name: (locale === 'de' ? de : fr).eventMenu.label })

/** The pages under the event's menu, where the trail steps aside. */
const UNDER_MENU = [
  { page: 'the event page', route: `/admin/events/${SLUG}` },
  { page: 'the settings page', route: `/admin/events/${SLUG}/settings` },
  { page: 'the invitations page', route: `/admin/events/${SLUG}/invitations` },
] as const

describe('the way back from an event page', () => {
  it('offers the console a link to the list of events, and to the event', async () => {
    at(signedIn(), `/admin/events/${SLUG}/moderation`)

    const nav = await trail()
    // The name arrives with the event, a moment after the first link.
    await within(nav).findByText(fr.moderation.title)

    const found = within(nav)
      .getAllByRole('link')
      .map((link) => [link.textContent?.replace('← ', ''), link.getAttribute('href')])
    expect(found).toEqual([
      [fr.admin.events, '/admin'],
      [NAME, `/admin/events/${SLUG}`],
    ])
    expect(within(nav).getByText(fr.moderation.title)).toHaveAttribute('aria-current', 'page')
    // Marked once, and never on a link: the page you are on is not a control.
    expect(nav.querySelectorAll('[aria-current]')).toHaveLength(1)
  })

  it.each(UNDER_MENU)(
    'offers $page the way back in the event menu, with no second trail above it',
    async ({ route }) => {
      at(signedIn(), route)

      const nav = await menu()
      expect(within(nav).getByRole('link', { name: fr.admin.events })).toHaveAttribute(
        'href',
        '/admin',
      )
      expect(within(nav).getByRole('link', { name: fr.eventMenu.home })).toHaveAttribute(
        'href',
        `/admin/events/${SLUG}`,
      )
      expect(await within(nav).findByText(NAME)).toBeVisible()
      expect(screen.queryByRole('navigation', { name: fr.admin.breadcrumbLabel })).toBeNull()
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
    at(signedIn(), `/admin/events/${SLUG}/moderation`, 'de')

    const nav = await trail('de')

    expect(await within(nav).findByRole('link', { name: NAME })).toBeVisible()
    expect(within(nav).getByRole('link', { name: de.admin.events })).toBeVisible()
    expect(within(nav).getByText(de.moderation.title)).toBeVisible()
  })

  it('reads the menu in the host language, and leaves the event name as it was written', async () => {
    at(signedIn(), `/admin/events/${SLUG}/settings`, 'de')

    const nav = await menu('de')

    expect(await within(nav).findByText(NAME)).toBeVisible()
    expect(within(nav).getByRole('link', { name: de.admin.events })).toBeVisible()
    expect(within(nav).getByRole('link', { name: de.eventMenu.sections.settings })).toBeVisible()
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

  it('leaves the settings page one way to the event home: the menu, not a trail beside it', async () => {
    at(signedIn(), `/admin/events/${SLUG}/settings`)
    await menu()

    const home = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === `/admin/events/${SLUG}`)
    expect(home).toHaveLength(1)
    expect(home[0]).toHaveAccessibleName(fr.eventMenu.home)
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

    await userEvent.click(await within(await menu()).findByRole('link', { name: fr.admin.events }))

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

  it('links the console only to pages the account can open', async () => {
    at(moderator(), `/admin/events/${SLUG}/moderation`)

    const nav = await trail()
    // The way out is there at once; the event's link and the page's name come with the read of the
    // event. Count the links only once that read is shown, or the count races the second item.
    await within(nav).findByRole('link', { name: fr.admin.events })
    await within(nav).findByText(fr.moderation.title)

    // Never the operator's console nor the client's space: this account has neither.
    for (const link of within(nav).getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(new RegExp(`^/admin(/events/${SLUG})?$`))
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(2)
  })

  it.each(UNDER_MENU)(
    'links the menu of $page only to pages the account can open',
    async ({ route }) => {
      at(moderator(), route)

      const nav = await menu()
      await within(nav).findByText(NAME)

      // The list, the event's own pages and the wall: never the operator's console, the client's
      // space, nor a page of the event that is the owner's.
      for (const link of within(nav).getAllByRole('link')) {
        expect(link.getAttribute('href')).toMatch(
          new RegExp(`^(/admin(/events/${SLUG}(/[a-z-]+)?)?|/e/${SLUG}/display)$`),
        )
      }
      for (const ownerOnly of [
        'settings',
        'invitations',
        'missions',
        'moderators',
        'share',
      ] as const) {
        expect(
          within(nav).queryByRole('link', { name: fr.eventMenu.sections[ownerOnly] }),
        ).toBeNull()
      }
    },
  )

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

    await userEvent.click(
      await within(await menu()).findByRole('link', { name: fr.eventMenu.home }),
    )

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
