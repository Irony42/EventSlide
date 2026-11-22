import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventChromeContext } from '../../../app/eventChrome'
import { HostBreadcrumb } from '../../../app/HostBreadcrumb'
import { fr } from '../../../lib/i18n/fr'
import {
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import type { Api } from '../../../lib/api/client'
import type { EventDto } from '../../../lib/api/dto'
import { EventRoutes } from '../testing/eventRoutes'
import { classesOf, cls } from '../../../testing/classesOf'
import styles from './EventNav.module.css'

const renderAt = (page: string, event: Partial<EventDto> = {}, api?: Api) =>
  renderWithProviders(<EventRoutes />, {
    api: api ?? fakeApi({ getEvent: vi.fn(async () => anEventDto(event)) }),
    route: '/admin/events/camille-et-sacha' + page,
  })

const menu = () => screen.findByRole('navigation', { name: fr.eventMenu.label })

/** A name read out as the parts said in order, whatever space the reader puts before a comma. */
const spoken = (...parts: readonly string[]): RegExp =>
  new RegExp(
    '^' + parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(' ?, ') + '$',
  )

describe('the event menu', () => {
  it('marks the moment the event is in, and only that one', async () => {
    renderAt('', { status: 'live' })

    const nav = await menu()
    const marks = within(nav).getAllByText(fr.eventMenu.current)
    expect(marks).toHaveLength(1)
    expect(marks[0]?.closest('p')).toHaveTextContent(fr.eventMenu.moments.during)
  })

  it('names each moment as a group of its entries', async () => {
    renderAt('')

    const nav = await menu()
    const evening = within(nav).getByRole('list', {
      name: new RegExp(fr.eventMenu.moments.during),
    })
    expect(
      within(evening).getByRole('link', { name: fr.eventMenu.sections.guestbook }),
    ).toBeVisible()
    expect(within(evening).queryByRole('link', { name: fr.eventMenu.sections.album })).toBeNull()
  })

  it('reads out the photos waiting with the queue’s entry, not as a lone number', async () => {
    renderAt('', { pendingCount: 3 })

    const nav = await menu()
    expect(
      within(nav).getByRole('link', {
        name: spoken(fr.eventMenu.sections.moderation, fr.moderation.pending(3)),
      }),
    ).toHaveAttribute('href', '/admin/events/camille-et-sacha/moderation')
  })

  it('marks the page the host is on', async () => {
    renderAt('/best-of')

    const nav = await menu()
    expect(within(nav).getByRole('link', { name: fr.eventMenu.sections.bestOf })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: fr.eventMenu.home })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('reads the event again, quietly, when the host moves to another page of it', async () => {
    const getEvent = vi.fn(async () => anEventDto())
    renderAt('', {}, fakeApi({ getEvent }))

    await userEvent.click(
      within(await menu()).getByRole('link', { name: fr.eventMenu.sections.guests }),
    )

    await waitFor(() => expect(getEvent).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(fr.admin.eventLoading)).toBeNull()
  })

  it('drops an entry the settings switched off, at the next read', async () => {
    // A guestbook switched off on the settings page leaves the menu at the next click.
    const getEvent = vi.fn(async () => anEventDto())
    getEvent.mockResolvedValueOnce(anEventDto())
    getEvent.mockResolvedValueOnce(
      anEventDto({ settings: eventSettings({ allowGuestbook: false }) }),
    )
    renderAt('', {}, fakeApi({ getEvent }))

    const nav = await menu()
    expect(within(nav).getByRole('link', { name: fr.eventMenu.sections.guestbook })).toBeVisible()
    await userEvent.click(within(nav).getByRole('link', { name: fr.eventMenu.sections.guests }))

    await waitFor(() =>
      expect(within(nav).queryByRole('link', { name: fr.eventMenu.sections.guestbook })).toBeNull(),
    )
  })
})

describe('beside a page that composes something to print or send', () => {
  const tabBarOf = () =>
    document.querySelector<HTMLElement>(`nav[aria-label="${fr.eventMenu.tabBar}"]`)

  it.each(['/print', '/invitations', '/book'])(
    'folds the menu to its glyphs and lets the page’s own bar replace the tab bar on %s',
    async (page) => {
      renderAt(page)

      expect(classesOf(await menu())).toContain(cls(styles, 'folded'))
      expect(classesOf(tabBarOf())).toContain(cls(styles, 'besideTools'))
    },
  )

  it('keeps the whole menu and the tab bar everywhere else', async () => {
    renderAt('/guests')

    expect(classesOf(await menu())).not.toContain(cls(styles, 'folded'))
    expect(classesOf(tabBarOf())).not.toContain(cls(styles, 'besideTools'))
  })
})

describe('the phone’s tab bar', () => {
  /**
   * The bar is hidden from a laptop's width up, the width the tests are drawn at, and a hidden
   * element has no accessible name to find it by: it is read by its label and its links' addresses.
   */
  const tab = async (href: string): Promise<HTMLElement> => {
    await menu()
    const bar = document.querySelector<HTMLElement>(`nav[aria-label="${fr.eventMenu.tabBar}"]`)
    const link = bar?.querySelector<HTMLElement>(`a[href="${href}"]`) ?? null
    if (link === null) throw new Error(`no tab to ${href}`)
    return link
  }

  it('lights the moment of the page the host is on', async () => {
    renderAt('/guests')

    expect(await tab('/admin/events/camille-et-sacha/during')).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(await tab('/admin/events/camille-et-sacha')).not.toHaveAttribute('aria-current')
  })

  it('says the photos waiting and the moment the event is in on the evening’s tab', async () => {
    renderAt('', { status: 'live', pendingCount: 2 })

    const evening = await tab('/admin/events/camille-et-sacha/during')
    expect(evening).toHaveTextContent(fr.eventMenu.momentsShort.during)
    expect(evening).toHaveTextContent(fr.moderation.pending(2))
    expect(evening).toHaveTextContent(fr.eventMenu.current)
    expect(await tab('/admin/events/camille-et-sacha/after')).not.toHaveTextContent(
      fr.eventMenu.current,
    )
  })
})

describe('a moment’s page', () => {
  it('lists its subjects with the line that says what is there', async () => {
    renderAt('/after', { status: 'closed' })

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: new RegExp(fr.eventMenu.moments.after),
      }),
    ).toHaveTextContent(fr.eventMenu.current)
    expect(screen.getByRole('link', { name: new RegExp(fr.eventMenu.hints.book) })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/book',
    )
  })

  it('closes the list of getting ready with the settings, for the owner alone', async () => {
    renderAt('/before')

    expect(
      await screen.findByRole('link', { name: new RegExp(fr.eventMenu.hints.settings) }),
    ).toHaveAttribute('href', '/admin/events/camille-et-sacha/settings')
  })

  it('gives a moderator no settings in it', async () => {
    renderAt('/before', { role: 'moderator' })

    await screen.findByRole('heading', { level: 1, name: new RegExp(fr.eventMenu.moments.before) })
    expect(screen.queryByRole('link', { name: new RegExp(fr.eventMenu.hints.settings) })).toBeNull()
  })
})

describe('the trail under the layout', () => {
  it('steps aside, since the menu already says where the host is', () => {
    renderWithProviders(
      <EventChromeContext.Provider value={true}>
        <HostBreadcrumb slug="camille-et-sacha" page="settings" eventName="Camille & Sacha" />
      </EventChromeContext.Provider>,
    )

    expect(screen.queryByRole('navigation', { name: fr.admin.breadcrumbLabel })).toBeNull()
  })

  it('is there on a page drawn on its own', () => {
    renderWithProviders(
      <HostBreadcrumb slug="camille-et-sacha" page="settings" eventName="Camille & Sacha" />,
    )

    expect(screen.getByRole('navigation', { name: fr.admin.breadcrumbLabel })).toBeVisible()
  })
})
