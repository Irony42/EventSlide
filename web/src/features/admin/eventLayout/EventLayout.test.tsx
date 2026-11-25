import { describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route } from 'react-router-dom'
import styles from './EventHomePage.module.css'
import layoutStyles from './EventLayout.module.css'
import { EventRoutes } from '../testing/eventRoutes'
import { ApiError } from '../../../lib/http'
import { formatBytes, formatDateTime } from '../../../lib/format'
import { fr } from '../../../lib/i18n/fr'
import { classesOf, cls } from '../../../testing/classesOf'
import {
  aSessionUser,
  anAbout,
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import type { Api } from '../../../lib/api/client'
import type { EventDto } from '../../../lib/api/dto'

const DASHBOARD = 'Tableau de bord'

/** Testing Library folds every kind of space in rendered text down to a plain one. */
const spaced = (value: string) => value.replace(/\s/g, ' ')

/** The event's pages under its layout, at its home page or at one of its pages (`/album`, `/share`…). */
const renderPage = (api: Api, page = '') =>
  renderWithProviders(
    <EventRoutes extra={<Route path="/admin" element={<p>{DASHBOARD}</p>} />} />,
    {
      api,
      route: '/admin/events/camille-et-sacha' + page,
    },
  )

/**
 * The status as the page's own header says it: the menu beside the page says it too, so a bare
 * `getByText` would find two.
 */
const statusInHeader = async (label: string): Promise<HTMLElement> => {
  const title = await screen.findByRole('heading', { level: 1 })
  const header = title.closest('header')
  if (header === null) throw new Error('the page title is not in a header')
  return within(header).findByText(label)
}

/** The last button carrying a label is the one inside the dialog that just opened. */
const inDialog = (name: string): HTMLElement => {
  const buttons = screen.getAllByRole('button', { name })
  const last = buttons[buttons.length - 1]
  // `noUncheckedIndexedAccess`: an empty list here would be a broken test, not a
  // component fault, so it fails loudly instead of clicking `undefined`.
  if (last === undefined) throw new Error(`no button named ${name}`)
  return last
}

describe('EventPage', () => {
  it('says it is working while the event loads', () => {
    const api = fakeApi({ getEvent: vi.fn(() => new Promise<EventDto>(() => {})) })

    renderPage(api)

    expect(screen.getByRole('status')).toHaveTextContent(fr.admin.eventLoading)
  })

  it('names the failure and offers a retry', async () => {
    const getEvent = vi.fn(async () => anEventDto())
    getEvent.mockRejectedValueOnce(ApiError.network())
    const api = fakeApi({ getEvent })

    renderPage(api)

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
  })

  it('offers the list of events inside the failure itself, beside the retry', async () => {
    renderPage(
      fakeApi({ getEvent: vi.fn(() => Promise.reject(new ApiError(404, 'event.notFound'))) }),
    )

    await screen.findByRole('alert')

    // The failure's own way out, beside Réessayer and not only in the trail above it: an address
    // that does not exist or an access that was withdrawn is not mended by asking again.
    const failure = screen.getByRole('alert')
    expect(within(failure).getByRole('button', { name: fr.app.retry })).toBeVisible()
    expect(within(failure).getByRole('link', { name: fr.admin.events })).toHaveAttribute(
      'href',
      '/admin',
    )
  })

  it('shows the join code, its link and a QR code drawn in the page', async () => {
    renderPage(fakeApi())

    expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    // Twice on purpose: once to read out to a guest, once on the card for the tables.
    expect(screen.getAllByText('H7K2QM').length).toBeGreaterThan(0)
    // The server built this URL. 1.0 assembled it in two places and they disagreed.
    expect(
      screen.getByRole('link', { name: 'https://photos.example/join/H7K2QM' }),
    ).toHaveAttribute('href', 'https://photos.example/join/H7K2QM')
    expect(screen.getByRole('img', { name: fr.admin.qrAlt('Camille & Sacha') })).toBeVisible()
    // The sentence for a guest is the paper's; on screen the card's buttons say what to do.
    expect(screen.getByText(fr.admin.qrScanPrompt)).toBeInTheDocument()
  })

  it('keeps the printed page to the access card: everything else is for the screen only', async () => {
    renderPage(fakeApi())
    await screen.findByRole('heading', { name: 'Camille & Sacha' })

    // The card for the tables is what the host prints; the "Maintenant" card has nothing to say on
    // paper, and `screenOnly` is what hides it there (the menu hides itself in print).
    const onScreenOnly = (element: HTMLElement): boolean => {
      for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
        if (classesOf(node).includes(cls(styles, 'screenOnly'))) return true
      }
      return false
    }
    expect(onScreenOnly(screen.getByRole('heading', { name: fr.admin.accessTitle }))).toBe(false)
    expect(onScreenOnly(screen.getByRole('heading', { level: 1, name: 'Camille & Sacha' }))).toBe(
      true,
    )
    expect(onScreenOnly(screen.getByRole('heading', { name: fr.admin.nowLiveTitle }))).toBe(true)
  })

  it('links to the wall, the moderation console, the settings and the album', async () => {
    renderPage(fakeApi())

    const menu = await screen.findByRole('navigation', { name: fr.eventMenu.label })
    expect(
      within(menu).getByRole('link', { name: fr.eventMenu.sections.settings }),
    ).toHaveAttribute('href', '/admin/events/camille-et-sacha/settings')
    await userEvent.click(within(menu).getByRole('link', { name: fr.eventMenu.sections.album }))
    // Built by the API client, so the ZIP link and the endpoint cannot drift apart.
    expect(await screen.findByRole('link', { name: fr.admin.download })).toHaveAttribute(
      'href',
      '/api/events/camille-et-sacha/album.zip',
    )
  })

  it('opens the screen and the queue from the "Maintenant" card of a live evening', async () => {
    renderPage(fakeApi())

    expect(await screen.findByRole('link', { name: fr.admin.openWall })).toHaveAttribute(
      'href',
      '/e/camille-et-sacha/display',
    )
    expect(screen.getByRole('link', { name: fr.admin.openModeration })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/moderation',
    )
  })

  it('offers one way into the moderation queue: it opens the phone’s screen on a phone by itself', async () => {
    renderPage(fakeApi())
    await screen.findByRole('heading', { name: 'Camille & Sacha' })

    expect(screen.getAllByRole('link', { name: fr.admin.openModeration })).toHaveLength(1)
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '')
    expect(hrefs.filter((href) => href.includes('/moderation/mobile'))).toEqual([])
  })

  it('leads a live event with the queue, what waits there, the screen and the way to end it', async () => {
    renderPage(
      fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'live', pendingCount: 3 })) }),
    )

    const now = (await screen.findByRole('heading', { name: fr.admin.nowLiveTitle })).closest(
      'section',
    )
    if (now === null) throw new Error('the "Maintenant" card is not a section')
    expect(
      within(now).getByRole('link', { name: fr.admin.openModeration }),
    ).toHaveAccessibleDescription(fr.admin.moderationWaiting(3))
    expect(within(now).getByRole('link', { name: fr.admin.openWall })).toBeVisible()
    expect(within(now).getByRole('button', { name: fr.admin.closeEvent })).toBeVisible()
    // It leads: before the access card.
    const access = screen.getByRole('heading', { name: fr.admin.accessTitle })
    expect(now.compareDocumentPosition(access) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('leads a draft with what to get ready and the button that opens the doors', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'draft' })) }))

    const now = (await screen.findByRole('heading', { name: fr.admin.nowDraftTitle })).closest(
      'section',
    )
    if (now === null) throw new Error('the "Maintenant" card is not a section')
    expect(within(now).getByRole('link', { name: fr.admin.nowDraftSettings })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/settings',
    )
    expect(within(now).getByRole('link', { name: fr.admin.nowDraftPrint })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/print',
    )
    const wall = within(now).getByRole('link', { name: fr.admin.nowDraftWall })
    expect(wall).toHaveAttribute('target', '_blank')
    expect(wall).toHaveAccessibleDescription(fr.about.opensInNewTab)
    expect(within(now).getByRole('button', { name: fr.admin.goLive })).toBeVisible()
  })

  it('gives a moderator of a draft only the steps that are theirs: no settings, no inviting, no opening', async () => {
    renderPage(
      fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'draft', role: 'moderator' })) }),
    )

    const now = (await screen.findByRole('heading', { name: fr.admin.nowDraftTitle })).closest(
      'section',
    )
    if (now === null) throw new Error('the "Maintenant" card is not a section')
    expect(within(now).getByRole('link', { name: fr.admin.nowDraftPrint })).toBeVisible()
    expect(within(now).getByRole('link', { name: fr.admin.nowDraftWall })).toBeVisible()
    expect(within(now).queryByRole('link', { name: fr.admin.nowDraftSettings })).toBeNull()
    expect(within(now).queryByRole('button', { name: fr.admin.nowDraftModerators })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.goLive })).toBeNull()
  })

  it('asks the owner of a draft for a logo while there is none, and leads to the Apparence page', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'draft' })) }))

    const now = (await screen.findByRole('heading', { name: fr.admin.nowDraftTitle })).closest(
      'section',
    )
    if (now === null) throw new Error('the "Maintenant" card is not a section')
    expect(within(now).getByRole('link', { name: fr.admin.nowDraftLogo })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/appearance',
    )
  })

  it('stops asking for the logo once the event has one', async () => {
    renderPage(
      fakeApi({
        getEvent: vi.fn(async () =>
          anEventDto({
            status: 'draft',
            settings: eventSettings({
              brand: {
                welcomeMessage: null,
                logoUrl: `/api/events/camille-et-sacha/logo/${'ab'.repeat(32)}`,
              },
            }),
          }),
        ),
      }),
    )

    const now = (await screen.findByRole('heading', { name: fr.admin.nowDraftTitle })).closest(
      'section',
    )
    if (now === null) throw new Error('the "Maintenant" card is not a section')
    expect(within(now).getByRole('link', { name: fr.admin.nowDraftPrint })).toBeVisible()
    expect(within(now).queryByRole('link', { name: fr.admin.nowDraftLogo })).toBeNull()
  })

  it('asks for the logo before the evening only: a live event is not sent to Apparence mid-party', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'live' })) }))

    await screen.findByRole('heading', { name: fr.admin.nowLiveTitle })
    expect(screen.queryByRole('link', { name: fr.admin.nowDraftLogo })).toBeNull()
  })

  it('does not ask a moderator for the logo', async () => {
    renderPage(
      fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'draft', role: 'moderator' })) }),
    )

    await screen.findByRole('heading', { name: fr.admin.nowDraftTitle })
    expect(screen.queryByRole('link', { name: fr.admin.nowDraftLogo })).toBeNull()
  })

  it('leads the owner of a draft to the invitations, from the "Maintenant" card and from the access card', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'draft' })) }))

    const now = (await screen.findByRole('heading', { name: fr.admin.nowDraftTitle })).closest(
      'section',
    )
    if (now === null) throw new Error('the "Maintenant" card is not a section')
    expect(within(now).getByRole('link', { name: fr.guestInvite.host.title })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/invitations',
    )
    // And the access card, and the menu's own entry: three ways to one page, each where the host
    // is looking (getting ready, printing the code, finding their way).
    expect(screen.getAllByRole('link', { name: fr.guestInvite.host.title })).toHaveLength(3)
  })

  it('does not lead a moderator to a page that only the owner writes', async () => {
    renderPage(
      fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'draft', role: 'moderator' })) }),
    )

    await screen.findByRole('heading', { name: fr.admin.nowDraftTitle })

    expect(screen.queryByRole('link', { name: fr.guestInvite.host.title })).toBeNull()
  })

  it('offers an archived event no invitations link, like no table cards', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'archived' })) }))

    await screen.findByRole('heading', { name: fr.admin.accessTitle })

    expect(screen.queryByRole('link', { name: fr.guestInvite.host.title })).toBeNull()
  })

  it('offers an archived event no table cards and no new code', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'archived' })) }))

    await screen.findByRole('heading', { name: fr.admin.accessTitle })
    expect(screen.queryByRole('link', { name: fr.admin.printKitTitle })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.rotateJoinCode })).toBeNull()
  })

  it('takes the host from a menu entry to that subject’s own page', async () => {
    renderPage(fakeApi())

    const menu = await screen.findByRole('navigation', { name: fr.eventMenu.label })
    await userEvent.click(within(menu).getByRole('link', { name: fr.eventMenu.sections.guests }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Camille & Sacha' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: fr.admin.guestList })).toBeVisible()
    expect(within(menu).getByRole('link', { name: fr.eventMenu.sections.guests })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('takes the owner of a draft from "invite someone to moderate" to the moderators panel', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'draft' })) }))

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.nowDraftModerators }))

    expect(await screen.findByRole('heading', { name: fr.admin.moderators })).toBeVisible()
  })

  it('shows the storage used against the quota the event actually has', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ usedBytes: 2_400_000, quotaBytes: 5_000_000_000 })),
    })

    renderPage(api, '/album')

    const bar = await screen.findByRole('progressbar', { name: fr.admin.storageLabel })
    expect(bar).toHaveAttribute('aria-valuenow', '2400000')
    expect(bar).toHaveAttribute('aria-valuemax', '5000000000')
    expect(
      screen.getByText(
        spaced(
          fr.admin.storageUsed(formatBytes(2_400_000, 'fr'), formatBytes(5_000_000_000, 'fr')),
        ),
      ),
    ).toBeVisible()
  })

  it('draws the meter against the quota the box holds the event to, not the one it was stored with', async () => {
    // G2-05's review, finding 4: the server now answers `quotaBytes` as the effective quota, and
    // the meter is drawn against exactly that number.
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ usedBytes: 1_000, quotaBytes: 2_000 })),
    })

    renderPage(api, '/album')

    const bar = await screen.findByRole('progressbar', { name: fr.admin.storageLabel })
    expect(bar).toHaveAttribute('aria-valuemax', '2000')
  })

  it('says when the live window of a client’s event closes, and says nothing when it has none', async () => {
    const closing = '2026-06-23T18:00:00.000Z'
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ liveWindowEnd: closing })),
    })

    renderPage(api, '/album')

    expect(
      await screen.findByText(
        fr.clientSpace.liveWindowEnd(formatDateTime(closing, 'fr') ?? closing),
      ),
    ).toBeVisible()
  })

  it('shows the storage used on the home page too, where the host looks during the evening', async () => {
    renderPage(
      fakeApi({ getEvent: vi.fn(async () => anEventDto({ usedBytes: 1_000, quotaBytes: 2_000 })) }),
    )

    const bar = await screen.findByRole('progressbar', { name: fr.admin.storageLabel })
    expect(bar).toHaveAttribute('aria-valuemax', '2000')
  })

  it('has no live window line for an event that has none', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto()) }), '/album')

    await screen.findByRole('progressbar', { name: fr.admin.storageLabel })
    expect(screen.queryByText(/L’évènement se termine/)).toBeNull()
  })

  it('asks before changing the join code, and says the connected guests stay connected', async () => {
    const api = fakeApi({
      rotateJoinCode: vi.fn(async () => anEventDto({ joinCode: 'ZX93PL' })),
    })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.rotateJoinCode }))

    expect(screen.getByText(fr.admin.rotateJoinCodeTitle)).toBeVisible()
    // What the change costs (the printed QR codes, the link already sent) and what it does
    // not (the guests already connected), said before they commit (HOT-2).
    expect(screen.getByText(fr.admin.rotateJoinCodeHint)).toBeVisible()
    expect(fr.admin.rotateJoinCodeHint).toContain('réimprimer')
    expect(api.rotateJoinCode).not.toHaveBeenCalled()

    await userEvent.click(inDialog(fr.admin.rotateJoinCode))

    expect(api.rotateJoinCode).toHaveBeenCalledWith('camille-et-sacha')
    expect(await screen.findByText(fr.admin.codeRotated)).toBeVisible()
    // The new code comes from the answer, not from anything guessed locally.
    expect(screen.getAllByText('ZX93PL').length).toBeGreaterThan(0)
  })

  it('takes the host to the QR card from the new-code toast, where the printed cards are out of date', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView']
    try {
      const api = fakeApi({
        rotateJoinCode: vi.fn(async () => anEventDto({ joinCode: 'ZX93PL' })),
      })

      renderPage(api)
      await userEvent.click(await screen.findByRole('button', { name: fr.admin.rotateJoinCode }))
      await userEvent.click(inDialog(fr.admin.rotateJoinCode))
      await userEvent.click(await screen.findByRole('button', { name: fr.admin.codeRotatedAction }))

      const heading = screen.getByRole('heading', { name: fr.admin.accessTitle })
      expect(scrollIntoView.mock.contexts[0]).toBe(heading)
      expect(heading).toHaveFocus()
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('leaves the code alone when the confirmation is cancelled', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.rotateJoinCode }))
    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(api.rotateJoinCode).not.toHaveBeenCalled()
    expect(screen.getAllByText('H7K2QM').length).toBeGreaterThan(0)
  })

  it('closes the event and shows the state the server came back with', async () => {
    const api = fakeApi({
      setEventStatus: vi.fn(async () => anEventDto({ status: 'closed' })),
    })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.closeEvent }))

    expect(api.setEventStatus).toHaveBeenCalledWith('camille-et-sacha', 'closed')
    expect(await statusInHeader(fr.admin.statusClosed)).toBeVisible()
    expect(screen.getByRole('button', { name: fr.admin.reopenEvent })).toBeVisible()
    // One toast per move, saying what changed for the room (HOT-13).
    expect(screen.getByText(fr.admin.noticeClosed)).toBeVisible()
  })

  it('does not offer to archive a live event beside the button that ends it', async () => {
    renderPage(fakeApi())

    expect(await screen.findByRole('button', { name: fr.admin.closeEvent })).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.admin.archiveEvent })).toBeNull()
  })

  it('archives a closed event only after saying it is final, and keeps the album downloadable', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ status: 'closed' })),
      setEventStatus: vi.fn(async () => anEventDto({ status: 'archived' })),
    })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.archiveEvent }))

    const dialog = screen.getByRole('dialog', { name: fr.admin.archiveTitle('Camille & Sacha') })
    expect(dialog).toHaveAccessibleDescription(fr.admin.archiveHint)
    expect(api.setEventStatus).not.toHaveBeenCalled()

    await userEvent.click(inDialog(fr.admin.archiveEvent))

    expect(api.setEventStatus).toHaveBeenCalledWith('camille-et-sacha', 'archived')
    expect(await screen.findByText(fr.admin.noticeArchived)).toBeVisible()
    expect(screen.getByText(fr.admin.settingsReadOnly)).toBeVisible()
  })

  it('archives a draft without promising an album, because none was ever made', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ status: 'draft' })),
      setEventStatus: vi.fn(async () => anEventDto({ status: 'archived' })),
    })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.archiveEvent }))

    // The sentence for an evening that happened says what stops and that the album stays; a draft
    // has no screen running and no album, so it gets its own.
    const dialog = screen.getByRole('dialog', { name: fr.admin.archiveTitle('Camille & Sacha') })
    expect(dialog).toHaveAccessibleDescription(fr.admin.archiveDraftHint)

    await userEvent.click(inDialog(fr.admin.archiveEvent))

    expect(await screen.findByText(fr.admin.noticeArchivedDraft)).toBeVisible()
    expect(screen.queryByText(fr.admin.noticeArchived)).toBeNull()
  })

  it('keeps the archive question on screen while the request is in flight, since the change will happen', async () => {
    // Annuler or Escape during the PATCH used to close the dialog and say no to a change that
    // then went through. The dialog is the host's view of it: it stays until the server answers.
    let answer: (event: EventDto) => void = () => {}
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ status: 'closed' })),
      setEventStatus: vi.fn(
        () =>
          new Promise<EventDto>((resolve) => {
            answer = resolve
          }),
      ),
    })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.archiveEvent }))
    await userEvent.click(inDialog(fr.admin.archiveEvent))
    await waitFor(() => expect(api.setEventStatus).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))
    await userEvent.keyboard('{Escape}')

    const name = fr.admin.archiveTitle('Camille & Sacha')
    expect(screen.getByRole('dialog', { name })).toBeVisible()

    await act(async () => {
      answer(anEventDto({ status: 'archived' }))
    })

    expect(await screen.findByText(fr.admin.noticeArchived)).toBeVisible()
    expect(screen.queryByRole('dialog', { name })).toBeNull()
  })

  it('leaves a closed event alone when the archive dialog is cancelled', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'closed' })) })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.archiveEvent }))
    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(api.setEventStatus).not.toHaveBeenCalled()
    expect(await statusInHeader(fr.admin.statusClosed)).toBeVisible()
  })

  it('says the event was reopened, in its own words', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ status: 'closed' })),
      setEventStatus: vi.fn(async () => anEventDto({ status: 'live' })),
    })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.reopenEvent }))

    // Reopening asks nothing: ending the evening undoes it.
    expect(api.setEventStatus).toHaveBeenCalledWith('camille-et-sacha', 'live')
    expect(await screen.findByText(fr.admin.noticeReopened)).toBeVisible()
  })

  it('offers no lifecycle action on an archived event and says it is frozen', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'archived' })) })

    renderPage(api)

    expect(await screen.findByText(fr.admin.settingsReadOnly)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.admin.archiveEvent })).toBeNull()
    expect(screen.queryByRole('link', { name: fr.admin.openWall })).toBeNull()
    expect(screen.queryByRole('link', { name: fr.admin.openModeration })).toBeNull()
    // The code cannot be rotated on an immutable event, so the button is not offered.
    expect(screen.queryByRole('button', { name: fr.admin.rotateJoinCode })).toBeNull()
  })

  it('gives the owner the shared gallery link, on the event it belongs to', async () => {
    const api = fakeApi()

    renderPage(api, '/share')

    expect(await screen.findByRole('heading', { name: fr.admin.shareLink })).toBeVisible()
    // The heading is there from the panel's first render, and the read is an effect that runs
    // after that commit: waiting for the heading is not waiting for the call.
    await waitFor(() =>
      expect(api.shareLink).toHaveBeenCalledWith('camille-et-sacha', expect.any(AbortSignal)),
    )
  })

  it('hides the owner-only controls from a moderator', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })) })

    renderPage(api)

    expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    // Every moderator endpoint requires an owner, so the panel is not rendered at all
    // rather than shown with every request coming back 403.
    expect(screen.queryByRole('heading', { name: fr.admin.moderators })).toBeNull()
    // Sending the album beyond the room is the owner's decision (roadmap §4.1), and every
    // share-link endpoint says so; a moderator is not shown a panel of 403s.
    expect(screen.queryByRole('heading', { name: fr.admin.shareLink })).toBeNull()
    expect(api.shareLink).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: fr.admin.purge })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.rotateJoinCode })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.closeEvent })).toBeNull()
    // Moderating is still their job.
    expect(screen.getByRole('link', { name: fr.admin.openModeration })).toBeVisible()
    // And the menu offers neither page.
    const menu = screen.getByRole('navigation', { name: fr.eventMenu.label })
    expect(within(menu).queryByRole('link', { name: fr.eventMenu.sections.moderators })).toBeNull()
    expect(within(menu).queryByRole('link', { name: fr.eventMenu.sections.share })).toBeNull()
    expect(within(menu).getByRole('link', { name: fr.eventMenu.sections.moderation })).toBeVisible()
  })

  it('tells a moderator who reaches an owner’s page by its address that it is not theirs', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })) })

    renderPage(api, '/share')

    expect(await screen.findByText(fr.eventMenu.notHere)).toBeVisible()
    expect(screen.getByRole('link', { name: fr.eventMenu.backHome })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha',
    )
    expect(api.shareLink).not.toHaveBeenCalled()
  })

  it('offers a moderator no settings tile, and an owner one', async () => {
    const moderator = fakeApi({ getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })) })
    const { unmount } = renderPage(moderator)
    await screen.findByRole('heading', { name: 'Camille & Sacha' })
    expect(screen.queryByRole('link', { name: fr.admin.settings })).toBeNull()
    unmount()

    renderPage(fakeApi())
    await screen.findByRole('heading', { name: 'Camille & Sacha' })
    expect(screen.getByRole('link', { name: fr.admin.settings })).toBeVisible()
  })

  it('deletes the album only once the address has been typed, then returns to the dashboard', async () => {
    const api = fakeApi()

    renderPage(api, '/album')
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.purge }))

    expect(screen.getByText(fr.admin.purgeWarning)).toBeVisible()
    expect(inDialog(fr.admin.purge)).toBeDisabled()
    expect(api.purgeEvent).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText(fr.admin.purgeConfirmLabel), 'camille-et-sacha')
    await userEvent.click(inDialog(fr.admin.purge))

    expect(api.purgeEvent).toHaveBeenCalledWith('camille-et-sacha')
    expect(await screen.findByText(fr.admin.purged('Camille & Sacha'))).toBeVisible()
    expect(await screen.findByText(DASHBOARD)).toBeVisible()
  })

  it('keeps the host on the page when a purge is refused', async () => {
    const api = fakeApi({
      purgeEvent: vi.fn(() => Promise.reject(new ApiError(403, 'auth.forbidden'))),
    })

    renderPage(api, '/album')
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.purge }))
    await userEvent.type(screen.getByLabelText(fr.admin.purgeConfirmLabel), 'camille-et-sacha')
    await userEvent.click(inDialog(fr.admin.purge))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['auth.forbidden'])
    expect(screen.queryByText(DASHBOARD)).toBeNull()
  })

  it('prints the QR card without leaving the page', async () => {
    const print = vi.fn()
    window.print = print

    renderPage(fakeApi())
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.printQr }))

    expect(print).toHaveBeenCalledTimes(1)
  })

  it('offers a draft event the action that opens the doors', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ status: 'draft' })),
      setEventStatus: vi.fn(async () => anEventDto({ status: 'live' })),
    })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.goLive }))

    // Opening cannot be taken back to a draft, so it asks once, and says why.
    expect(screen.getByText(fr.admin.openHint)).toBeVisible()
    expect(api.setEventStatus).not.toHaveBeenCalled()

    await userEvent.click(inDialog(fr.admin.goLive))

    expect(api.setEventStatus).toHaveBeenCalledWith('camille-et-sacha', 'live')
    expect(await statusInHeader(fr.admin.statusLive)).toBeVisible()
    expect(screen.getByText(fr.admin.noticeOpened)).toBeVisible()
  })

  it('does not open a draft to guests when the host backs out of the question', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'draft' })) })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.goLive }))
    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(api.setEventStatus).not.toHaveBeenCalled()
    expect(await statusInHeader(fr.admin.statusDraft)).toBeVisible()
  })

  it('offers the screen from a draft, in a new tab, from the menu and from the steps', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'draft' })) })

    renderPage(api)

    const menu = await screen.findByRole('navigation', { name: fr.eventMenu.label })
    const wall = within(menu).getByRole('link', { name: new RegExp(fr.eventMenu.sections.wall) })
    expect(wall).toHaveAttribute('href', '/e/camille-et-sacha/display')
    expect(wall).toHaveAttribute('target', '_blank')
    expect(wall).toHaveTextContent(fr.eventMenu.newTab)
    expect(screen.getByRole('link', { name: fr.admin.nowDraftWall })).toHaveAttribute(
      'href',
      '/e/camille-et-sacha/display',
    )
  })

  it('keeps the event as it was when the server refuses a change of state', async () => {
    // The badge is what a host checks before telling the room the wall is open. It
    // must never show a state the server did not record.
    const api = fakeApi({
      setEventStatus: vi.fn(() => Promise.reject(new ApiError(409, 'event.illegalTransition'))),
    })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.closeEvent }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['event.illegalTransition'])
    expect(await statusInHeader(fr.admin.statusLive)).toBeVisible()
  })

  it('keeps the old join code when the server refuses to change it', async () => {
    // The printed cards on the tables still carry the old code. Showing a new one that
    // was never recorded would send every guest to a code that does not resolve.
    const api = fakeApi({
      rotateJoinCode: vi.fn(() => Promise.reject(new ApiError(403, 'auth.forbidden'))),
    })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.rotateJoinCode }))
    await userEvent.click(inDialog(fr.admin.rotateJoinCode))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['auth.forbidden'])
    expect(screen.getAllByText('H7K2QM').length).toBeGreaterThan(0)
  })

  it('leaves the album alone when the purge dialog is cancelled', async () => {
    const api = fakeApi()

    renderPage(api, '/album')
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.purge }))
    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(api.purgeEvent).not.toHaveBeenCalled()
    expect(screen.queryByText(fr.admin.purgeWarning)).toBeNull()
  })

  it('shows how many photos are waiting for a decision', async () => {
    // The one number a host glances at between courses, so it is on the event page as
    // well as in the console.
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ pendingCount: 3 })) })

    renderPage(api)

    expect(await screen.findByText(fr.moderation.pending(3))).toBeVisible()
  })

  it('says something readable when the event could not be loaded for a reason with no code', async () => {
    // Anything that is not an `ApiError` is a bug in this build, and its message is an
    // internal English string. A host must never be shown one.
    const getEvent = vi.fn(async () => anEventDto())
    getEvent.mockRejectedValueOnce(new TypeError('Cannot read properties of undefined'))

    renderPage(fakeApi({ getEvent }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.unknown)
    expect(screen.queryByText(/Cannot read properties/)).toBeNull()
  })
})

/**
 * The one mention of the project's funding a host meets (roadmap G4-02): a card on the page
 * of a **closed** event, on an instance whose operator set `DONATION_URL`, that can be
 * closed and then stays closed for that event.
 */
describe('EventPage: the Telegram group panel (spec 27)', () => {
  const withBot = {
    channels: vi.fn(async () => ({
      available: true,
      botUsername: 'EventSlideBot',
      allowed: true,
      readsAllMessages: true,
      bindings: [],
    })),
  }

  it('shows the panel, with the current join code, while the host switched Telegram on', async () => {
    const api = fakeApi({
      ...withBot,
      getEvent: vi.fn(async () => anEventDto({ settings: eventSettings({ allowTelegram: true }) })),
    })

    renderPage(api, '/telegram')

    expect(await screen.findByRole('heading', { name: fr.channels.title })).toBeVisible()
    expect(await screen.findByText(fr.channels.step1('EventSlideBot'))).toBeVisible()
  })

  it('shows nothing while the switch is off, and reads nothing from the box', async () => {
    const api = fakeApi({
      ...withBot,
      getEvent: vi.fn(async () =>
        anEventDto({ settings: eventSettings({ allowTelegram: false }) }),
      ),
    })

    renderPage(api)
    const menu = await screen.findByRole('navigation', { name: fr.eventMenu.label })

    expect(within(menu).queryByRole('link', { name: fr.eventMenu.sections.telegram })).toBeNull()
    expect(screen.queryByRole('heading', { name: fr.channels.title })).toBeNull()
    expect(api.channels).not.toHaveBeenCalled()
  })
})

describe('EventPage, after the evening', () => {
  const renderClosed = (
    status: 'closed' | 'archived' = 'closed',
    role: 'owner' | 'moderator' = 'owner',
  ) => renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto({ status, role })) }))

  it('leads a closed event with the album, before the code', async () => {
    renderClosed()

    const after = await screen.findByRole('heading', { name: fr.admin.nowClosedTitle })
    const code = screen.getByRole('heading', { name: fr.admin.accessTitle })
    expect(after.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('leads an archived event with the album too', async () => {
    renderClosed('archived')

    expect(await screen.findByRole('heading', { name: fr.admin.nowArchivedTitle })).toBeVisible()
  })

  it('has no such card while the event is a draft or live', async () => {
    renderPage(fakeApi())

    await screen.findByRole('heading', { name: 'Camille & Sacha' })
    expect(screen.queryByRole('heading', { name: fr.admin.nowClosedTitle })).toBeNull()
  })

  it('offers the album download in the card', async () => {
    renderClosed()

    const card = (await screen.findByRole('heading', { name: fr.admin.nowClosedTitle })).closest(
      'section',
    )
    if (card === null) throw new Error('the card is not a section')
    expect(within(card).getByRole('link', { name: fr.admin.download })).toHaveAttribute('download')
  })

  it('takes the owner to the shared album’s page from the card', async () => {
    renderClosed()

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.afterShare }))

    expect(await screen.findByRole('heading', { name: fr.admin.shareLink })).toBeVisible()
  })

  it('offers a moderator the download but no way to make the link, which is the owner’s', async () => {
    renderClosed('closed', 'moderator')

    await screen.findByRole('heading', { name: fr.admin.nowClosedTitle })
    expect(screen.queryByRole('button', { name: fr.admin.afterShare })).toBeNull()
    expect(screen.getAllByRole('link', { name: fr.admin.download }).length).toBeGreaterThan(0)
  })
})

describe('EventPage, what is armed to happen by itself', () => {
  const draftWith = (overrides: Partial<EventDto>) =>
    renderPage(
      fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'draft', ...overrides })) }),
    )

  it('says the opening is armed, with the way to change it, so the host need not open "to be safe"', async () => {
    // Far from today on purpose, so the line carries a date whenever the test runs.
    draftWith({ scheduledOpenAt: '2031-06-20T16:00:00.000Z' })

    const line = await screen.findByText(/Ouverture automatique/)
    expect(line).toBeVisible()
    expect(line.parentElement).toHaveTextContent(fr.admin.autoEdit)
    expect(screen.getByRole('link', { name: fr.admin.autoEdit })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/settings',
    )
  })

  it('names the closing of a live event', async () => {
    renderPage(
      fakeApi({
        getEvent: vi.fn(async () =>
          anEventDto({ status: 'live', scheduledCloseAt: '2031-06-21T00:00:00.000Z' }),
        ),
      }),
    )

    expect(await screen.findByText(/Fin automatique/)).toBeVisible()
  })

  it('shows nothing when no schedule is armed', async () => {
    draftWith({})

    await screen.findByRole('heading', { name: 'Camille & Sacha' })
    expect(screen.queryByText(/automatique/)).toBeNull()
  })

  it('warns, at the top of the page, that the sweep threw the schedule away', async () => {
    draftWith({ scheduleDiscardedAt: '2031-06-20T16:00:00.000Z' })

    await screen.findByRole('heading', { name: 'Camille & Sacha' })
    const warning = screen
      .getByText(/n’a pas pu s’appliquer/)
      .closest<HTMLElement>('[role="status"]')
    if (warning === null) throw new Error('the warning is not a status')
    expect(warning).toHaveAttribute('role', 'status')
    expect(
      within(warning).getByRole('link', { name: fr.admin.scheduleDiscardedAction }),
    ).toBeVisible()
  })

  it('warns a moderator that the schedule was thrown away, without the way to set another', async () => {
    draftWith({ role: 'moderator', scheduleDiscardedAt: '2031-06-20T16:00:00.000Z' })

    const warning = (await screen.findByText(/n’a pas pu s’appliquer/)).closest('[role="status"]')
    if (warning === null) throw new Error('the warning is not a status')
    expect(within(warning as HTMLElement).queryByRole('link')).toBeNull()
  })

  it('never gives two links on the page the same name', async () => {
    // The schedule's line, the warning, the draft's first step and the overview's tile all lead to
    // the settings; a screen-reader list of links once read "Modifier, Modifier" with no way to
    // tell which was which.
    draftWith({
      scheduledOpenAt: '2031-06-20T16:00:00.000Z',
      scheduleDiscardedAt: '2031-06-19T16:00:00.000Z',
    })

    await screen.findByText(/Ouverture automatique/)
    const toSettings = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/admin/events/camille-et-sacha/settings')
      .map((link) => link.textContent)
    expect(toSettings).toHaveLength(4)
    expect(new Set(toSettings).size).toBe(toSettings.length)
  })

  it('offers a moderator the times but not the way to change them', async () => {
    draftWith({ role: 'moderator', scheduledOpenAt: '2031-06-20T16:00:00.000Z' })

    expect(await screen.findByText(/Ouverture automatique/)).toBeVisible()
    expect(screen.queryByRole('link', { name: fr.admin.autoEdit })).toBeNull()
  })
})

describe('EventPage, the support card', () => {
  const DONATE_URL = 'https://opencollective.com/eventslide'
  const BUDGET_URL = 'https://opencollective.com/eventslide/budget'

  const renderFor = (
    status: EventDto['status'],
    links: { donate?: string; budget?: string } = { donate: DONATE_URL },
    event: Partial<EventDto> = {},
  ) =>
    renderPage(
      fakeApi({
        getEvent: vi.fn(async () => anEventDto({ status, ...event })),
        about: vi.fn(async () => anAbout({ links })),
      }),
    )

  const card = () => screen.queryByText(fr.about.supportNoCounterpart)

  /**
   * Waits until `GET /api/about` has been **answered and applied**, so that "the card is
   * absent" is a statement about the answer and not about a request still in flight. An
   * absence asserted before then would pass on a page that was about to show the card.
   */
  const aboutApplied = async (api: Api) => {
    await waitFor(() => expect(api.about).toHaveBeenCalled())
    await act(async () => {
      await vi.mocked(api.about).mock.results[0]?.value
    })
  }

  it('is offered on a closed event when the operator set DONATION_URL', async () => {
    renderFor('closed')

    expect(await screen.findByText(fr.about.supportNoCounterpart)).toBeVisible()
    expect(screen.getByRole('link', { name: new RegExp(fr.about.supportLink) })).toHaveAttribute(
      'href',
      DONATE_URL,
    )
  })

  it('names the public budget when the operator publishes one', async () => {
    renderFor('closed', { donate: DONATE_URL, budget: BUDGET_URL })

    expect(
      await screen.findByRole('link', { name: new RegExp(fr.about.budgetLink) }),
    ).toHaveAttribute('href', BUDGET_URL)
  })

  it.each(['draft', 'live', 'archived'] as const)(
    'is not offered on a %s event, only after it has closed',
    async (status) => {
      const { api } = renderFor(status)

      expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
      await aboutApplied(api)

      expect(card()).toBeNull()
    },
  )

  it('is not offered on a box that set no DONATION_URL, so a self-hoster sees nothing', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ status: 'closed' })),
      about: vi.fn(async () => anAbout({ links: {} })),
    })
    renderPage(api)

    expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    await aboutApplied(api)

    expect(card()).toBeNull()
    expect(screen.queryByText(fr.about.supportTitle)).toBeNull()
  })

  it('is not offered on a budget alone, because there is no donation to ask for', async () => {
    const { api } = renderFor('closed', { budget: BUDGET_URL })

    expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    await aboutApplied(api)

    expect(card()).toBeNull()
  })

  it('appears when the host closes the event from this page', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ status: 'live' })),
      setEventStatus: vi.fn(async () => anEventDto({ status: 'closed' })),
      about: vi.fn(async () => anAbout({ links: { donate: DONATE_URL } })),
    })
    renderPage(api)
    expect(card()).toBeNull()

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.closeEvent }))

    expect(await screen.findByText(fr.about.supportNoCounterpart)).toBeVisible()
  })

  it('is offered to a moderator too, who is on this page for the same event', async () => {
    renderFor('closed', { donate: DONATE_URL }, { role: 'moderator' })

    expect(await screen.findByText(fr.about.supportNoCounterpart)).toBeVisible()
  })

  it('goes when the host closes it, and does not come back on the next visit to that event', async () => {
    const first = renderFor('closed')
    await userEvent.click(await screen.findByRole('button', { name: fr.about.supportDismiss }))
    expect(card()).toBeNull()
    first.unmount()

    const { api } = renderFor('closed')

    expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    await aboutApplied(api)

    expect(card()).toBeNull()
  })

  it('stays closed when the event is reopened and closed again, because it is once per event', async () => {
    const first = renderFor('closed')
    await userEvent.click(await screen.findByRole('button', { name: fr.about.supportDismiss }))
    first.unmount()

    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ status: 'live' })),
      setEventStatus: vi.fn(async () => anEventDto({ status: 'closed' })),
      about: vi.fn(async () => anAbout({ links: { donate: DONATE_URL } })),
    })
    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.closeEvent }))
    await statusInHeader(fr.admin.statusClosed)
    await aboutApplied(api)

    expect(card()).toBeNull()
  })

  it('is remembered per event: closing it for one event does not close it for the next', async () => {
    const first = renderFor('closed', { donate: DONATE_URL }, { id: 'event-1' })
    await userEvent.click(await screen.findByRole('button', { name: fr.about.supportDismiss }))
    first.unmount()

    renderFor('closed', { donate: DONATE_URL }, { id: 'event-2' })

    expect(await screen.findByText(fr.about.supportNoCounterpart)).toBeVisible()
  })

  it('is offered again for the next event when the host walks to it without leaving the page', async () => {
    // One layout instance serves every `/admin/events/:slug`: React Router keeps it
    // mounted when only the parameter changes. A "closed it" held in that instance's state
    // would carry over to the next event and hide a card that event is owed.
    const api = fakeApi({
      getEvent: vi.fn(async (slug: string) =>
        anEventDto({ slug, id: `id-${slug}`, name: `Fête ${slug}`, status: 'closed' }),
      ),
      about: vi.fn(async () => anAbout({ links: { donate: DONATE_URL } })),
    })
    renderWithProviders(
      <>
        <Link to="/admin/events/deuxieme">suivant</Link>
        <EventRoutes />
      </>,
      { api, route: '/admin/events/premier' },
    )
    await userEvent.click(await screen.findByRole('button', { name: fr.about.supportDismiss }))
    expect(card()).toBeNull()

    await userEvent.click(screen.getByRole('link', { name: 'suivant' }))

    expect(await screen.findByRole('heading', { name: 'Fête deuxieme' })).toBeVisible()
    expect(await screen.findByText(fr.about.supportNoCounterpart)).toBeVisible()
  })
})

describe('EventPage: the first visit’s guided tour', () => {
  const signedIn = (toursSeen: readonly string[]) =>
    vi.fn(async () => ({ authenticated: true as const, user: aSessionUser({ toursSeen }) }))

  it('opens by itself on an account’s first visit, and records it as seen when it is left', async () => {
    const api = fakeApi({ session: signedIn([]) })
    renderPage(api)

    const tour = await screen.findByRole('dialog', { name: fr.admin.tourWelcomeTitle })
    await userEvent.click(within(tour).getByRole('button', { name: fr.ui.tourLater }))

    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(api.markTourSeen).toHaveBeenCalledWith('eventPage'))
    // Focus lands on the button that brings the tour back, so the host learns where it lives.
    expect(screen.getByRole('button', { name: fr.admin.tourButton })).toHaveFocus()
  })

  it('walks through the page to the end, and records it once', async () => {
    // A draft: the first visit is almost always right after the event was created.
    const api = fakeApi({
      session: signedIn([]),
      getEvent: vi.fn(async () => anEventDto({ status: 'draft' })),
    })
    renderPage(api)

    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: fr.ui.tourStart }),
    )
    // Each step is shown once it is measured, on the next frame.
    expect(await screen.findByRole('dialog', { name: fr.admin.tourNowTitle })).toBeVisible()
    for (const title of [
      fr.admin.tourAccessTitle,
      fr.admin.tourOpenTitle,
      fr.admin.tourEveningTitle,
      fr.admin.tourOverviewTitle,
      fr.admin.tourEndTitle,
    ]) {
      await userEvent.click(await screen.findByRole('button', { name: fr.ui.tourNext }))
      expect(await screen.findByRole('dialog', { name: title })).toBeVisible()
    }
    await userEvent.click(await screen.findByRole('button', { name: fr.ui.tourFinish }))

    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(api.markTourSeen).toHaveBeenCalledOnce())
  })

  it('does not open by itself for an account that saw it, and the button still replays it', async () => {
    const api = fakeApi({ session: signedIn(['eventPage']) })
    renderPage(api)

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.tourButton }))
    // The same tour, from the top.
    const tour = await screen.findByRole('dialog', { name: fr.admin.tourWelcomeTitle })
    await userEvent.click(within(tour).getByRole('button', { name: fr.ui.tourLater }))

    // It was already seen: nothing new to record.
    expect(api.markTourSeen).not.toHaveBeenCalled()
  })

  it('does not cover the queue of an evening with photos waiting', async () => {
    const api = fakeApi({
      session: signedIn([]),
      getEvent: vi.fn(async () => anEventDto({ status: 'live', pendingCount: 4 })),
    })
    renderPage(api)

    expect(await screen.findByRole('button', { name: fr.admin.tourButton })).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('leaves the lifecycle out for a moderator, who has no lifecycle buttons', async () => {
    const api = fakeApi({
      session: signedIn([]),
      getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })),
    })
    renderPage(api)

    const tour = await screen.findByRole('dialog', { name: fr.admin.tourWelcomeModeratorTitle })
    await userEvent.click(within(tour).getByRole('button', { name: fr.ui.tourStart }))
    await screen.findByRole('dialog', { name: fr.admin.tourNowTitle })
    await userEvent.click(screen.getByRole('button', { name: fr.ui.tourNext }))
    await screen.findByRole('dialog', { name: fr.admin.tourAccessTitle })
    await userEvent.click(screen.getByRole('button', { name: fr.ui.tourNext }))

    expect(await screen.findByRole('dialog', { name: fr.admin.tourEveningTitle })).toBeVisible()
  })
})

describe('the reveal band on the console (spec 23)', () => {
  const NOW = Date.now()
  const heldEvent = (overrides: Partial<EventDto> = {}): EventDto =>
    anEventDto({
      settings: eventSettings({
        reveal: { enabled: true, at: new Date(NOW + 3_600_000).toISOString(), film: true },
      }),
      reveal: {
        enabled: true,
        revealed: false,
        atMs: NOW + 3_600_000,
        serverNowMs: NOW,
        film: true,
        readyCount: 12,
      },
      ...overrides,
    })

  it('gives the reveal a page of its own, in the evening’s part of the menu, when the mode is on', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => heldEvent()) }), '/reveal')

    expect(await screen.findByRole('heading', { name: fr.reveal.title })).toBeVisible()
    expect(screen.getByRole('button', { name: fr.reveal.revealNow })).toBeVisible()
    const menu = screen.getByRole('navigation', { name: fr.eventMenu.label })
    expect(within(menu).getByRole('link', { name: fr.eventMenu.sections.reveal })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('offers no reveal at all while the mode is off', async () => {
    renderPage(fakeApi())

    const menu = await screen.findByRole('navigation', { name: fr.eventMenu.label })

    expect(within(menu).queryByRole('link', { name: fr.eventMenu.sections.reveal })).toBeNull()
    expect(screen.queryByRole('heading', { name: fr.reveal.title })).toBeNull()
  })

  it('lets a moderator reveal but sends them to no settings page', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => heldEvent({ role: 'moderator' })) }))

    expect(
      within(await screen.findByTestId('reveal-banner')).getByRole('button', {
        name: fr.reveal.revealNow,
      }),
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: fr.reveal.editTime })).toBeNull()
  })

  it('lets the owner move the hour from the band', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => heldEvent()) }), '/reveal')

    expect(await screen.findByRole('link', { name: fr.reveal.editTime })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/settings',
    )
  })

  it('replaces the page’s event with the answer to "Révéler maintenant"', async () => {
    const revealed = heldEvent({
      reveal: {
        enabled: true,
        revealed: true,
        atMs: NOW,
        serverNowMs: NOW,
        film: true,
        readyCount: null,
      },
    })
    const api = fakeApi({
      getEvent: vi.fn(async () => heldEvent()),
      revealEvent: vi.fn(async () => revealed),
    })

    renderPage(api, '/reveal')
    const section = (await screen.findByRole('heading', { name: fr.reveal.title })).closest(
      'section',
    )
    await userEvent.click(
      within(section as HTMLElement).getByRole('button', { name: fr.reveal.revealNow }),
    )
    await userEvent.click(inDialog(fr.reveal.revealNow))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: fr.reveal.revealNow })).toBeNull(),
    )
    expect(api.revealEvent).toHaveBeenCalledTimes(1)
    expect(api.getEvent).toHaveBeenCalledTimes(1)
  })

  describe('the banner at the top of the page (spec 23b, point 4)', () => {
    const banner = () => screen.findByTestId('reveal-banner')

    it('says the hour, the time left and how many photographs wait, above the "Maintenant" card', async () => {
      // Half a minute short of the hour, so the rounding up of a started minute lands on "1 h 00".
      const soon = heldEvent({
        reveal: {
          enabled: true,
          revealed: false,
          atMs: NOW + 3_570_000,
          serverNowMs: NOW,
          film: true,
          readyCount: 12,
        },
      })
      renderPage(fakeApi({ getEvent: vi.fn(async () => soon) }))

      const line = await banner()
      expect(line).toHaveTextContent(fr.reveal.title)
      expect(line).toHaveTextContent(fr.reveal.guestLeft(1, 0))
      expect(line).toHaveTextContent(fr.reveal.bannerWaiting(12))
      expect(
        line.compareDocumentPosition(screen.getByRole('heading', { name: fr.admin.nowLiveTitle })) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('says the reveal is at the button when no hour is set', async () => {
      renderPage(
        fakeApi({
          getEvent: vi.fn(async () =>
            heldEvent({
              reveal: {
                enabled: true,
                revealed: false,
                atMs: null,
                serverNowMs: NOW,
                film: true,
                readyCount: 3,
              },
            }),
          ),
        }),
      )

      expect(await banner()).toHaveTextContent(fr.reveal.bannerManual)
    })

    it('reveals with the same confirmation and the same call as the section, from the banner', async () => {
      const revealed = heldEvent({
        reveal: {
          enabled: true,
          revealed: true,
          atMs: NOW,
          serverNowMs: NOW,
          film: true,
          readyCount: null,
        },
      })
      const api = fakeApi({
        getEvent: vi.fn(async () => heldEvent()),
        revealEvent: vi.fn(async () => revealed),
      })
      renderPage(api)

      await userEvent.click(
        within(await banner()).getByRole('button', { name: fr.reveal.revealNow }),
      )
      expect(api.revealEvent).not.toHaveBeenCalled()
      const dialog = within(screen.getByRole('dialog'))
      expect(dialog.getByText(fr.reveal.confirmTitle)).toBeVisible()
      expect(dialog.getByText(new RegExp(fr.reveal.definitive))).toBeVisible()
      await userEvent.click(inDialog(fr.reveal.revealNow))

      await waitFor(() => expect(screen.queryByTestId('reveal-banner')).toBeNull())
      expect(api.revealEvent).toHaveBeenCalledTimes(1)
      expect(api.getEvent).toHaveBeenCalledTimes(1)
    })

    it('is gone once the evening is revealed, and the section says when', async () => {
      const revealedEvent = () =>
        heldEvent({
          reveal: {
            enabled: true,
            revealed: true,
            atMs: NOW - 60_000,
            serverNowMs: NOW,
            film: true,
            readyCount: null,
          },
        })
      const home = renderPage(fakeApi({ getEvent: vi.fn(async () => revealedEvent()) }))
      await screen.findByRole('heading', { level: 1, name: 'Camille & Sacha' })
      expect(screen.queryByTestId('reveal-banner')).toBeNull()
      home.unmount()

      renderPage(
        fakeApi({
          getEvent: vi.fn(async () =>
            heldEvent({
              reveal: {
                enabled: true,
                revealed: true,
                atMs: NOW - 60_000,
                serverNowMs: NOW,
                film: true,
                readyCount: null,
              },
            }),
          ),
        }),
        '/reveal',
      )

      expect(await screen.findByRole('heading', { name: fr.reveal.title })).toBeVisible()
    })

    it('is not there on an evening without the mode', async () => {
      renderPage(fakeApi())

      await screen.findByRole('heading', { name: fr.admin.nowLiveTitle })

      expect(screen.queryByTestId('reveal-banner')).toBeNull()
    })
  })
})

describe('the reveal band, at the hour and at the closing (spec 23)', () => {
  const NOW = new Date('2026-06-20T21:00:00.000Z').getTime()
  const held = (overrides: Partial<EventDto> = {}, inMs = 10_000): EventDto =>
    anEventDto({
      settings: eventSettings({
        reveal: { enabled: true, at: new Date(NOW + inMs).toISOString(), film: true },
      }),
      reveal: {
        enabled: true,
        revealed: false,
        atMs: NOW + inMs,
        serverNowMs: NOW,
        film: true,
        readyCount: 12,
      },
      ...overrides,
    })

  it('re-reads the event at the hour without swapping the console for the loading page', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
    try {
      const getEvent = vi.fn(async () => held())
      getEvent.mockResolvedValueOnce(held())
      const past = held({}, -1_000)
      const revealedNow: EventDto = {
        ...past,
        ...(past.reveal === undefined
          ? {}
          : { reveal: { ...past.reveal, revealed: true, readyCount: null } }),
      }
      getEvent.mockResolvedValueOnce(revealedNow)
      renderPage(fakeApi({ getEvent }), '/announcements')

      const draft = await screen.findByLabelText(fr.announcement.text)
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(draft, 'Le gâteau')

      await act(async () => {
        vi.advanceTimersByTime(15_000)
      })

      await waitFor(() => expect(getEvent).toHaveBeenCalledTimes(2))
      // The layout read the event again quietly: the half-typed announcement on its page is still
      // there, and the page never said it was loading.
      expect(screen.queryByText(fr.admin.eventLoading)).toBeNull()
      expect(screen.getByLabelText(fr.announcement.text)).toHaveValue('Le gâteau')
      expect(screen.getByLabelText(fr.announcement.text)).toBe(draft)
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks before ending an evening whose photos were never revealed, and says why', async () => {
    const setEventStatus = vi.fn(async () => held({ status: 'closed' }))
    renderPage(fakeApi({ getEvent: vi.fn(async () => held({}, 3_600_000)), setEventStatus }))

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.closeEvent }))

    expect(setEventStatus).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(fr.reveal.closeHeld)).toBeVisible()

    await userEvent.click(within(dialog).getByRole('button', { name: fr.admin.closeEvent }))

    expect(setEventStatus).toHaveBeenCalledWith('camille-et-sacha', 'closed')
  })

  it('ends a revealed or ordinary evening on one press, as before', async () => {
    const setEventStatus = vi.fn(async () => anEventDto({ status: 'closed' }))
    renderPage(fakeApi({ setEventStatus }))

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.closeEvent }))

    expect(setEventStatus).toHaveBeenCalledWith('camille-et-sacha', 'closed')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the width of the page', () => {
  /** The layout that holds the menu and the page: it says how wide `main` may grow. */
  const layout = async (): Promise<Element> =>
    waitFor(() => {
      const found = document.getElementsByClassName(cls(layoutStyles, 'layout'))[0]
      if (found === undefined) throw new Error('no event layout on screen')
      return found
    })

  it.each(['/rsvps', '/rsvps/guests', '/appearance'])(
    'widens %s past the host width, the menu keeping its names',
    async (page) => {
      renderPage(fakeApi(), page)

      const classes = classesOf(await layout())
      expect(classes).toContain(cls(layoutStyles, 'wide'))
      expect(classes).not.toContain(cls(layoutStyles, 'workshop'))
    },
  )

  it.each(['', '/guests', '/settings'])('keeps the host width on "%s"', async (page) => {
    renderPage(fakeApi(), page)

    expect(classesOf(await layout())).not.toContain(cls(layoutStyles, 'wide'))
  })
})
