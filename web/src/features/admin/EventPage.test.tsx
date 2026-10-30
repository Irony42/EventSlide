import { describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes } from 'react-router-dom'
import { EventPage } from './EventPage'
import styles from './EventPage.module.css'
import { ApiError } from '../../lib/http'
import { formatBytes, formatDateTime } from '../../lib/format'
import { fr } from '../../lib/i18n/fr'
import { classesOf, cls } from '../../testing/classesOf'
import {
  anAbout,
  anEventDto,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { EventDto } from '../../lib/api/dto'

const DASHBOARD = 'Tableau de bord'

/** Testing Library folds every kind of space in rendered text down to a plain one. */
const spaced = (value: string) => value.replace(/\s/g, ' ')

const renderPage = (api: Api) =>
  renderWithProviders(
    <Routes>
      <Route path="/admin" element={<p>{DASHBOARD}</p>} />
      <Route path="/admin/events/:slug" element={<EventPage />} />
    </Routes>,
    { api, route: '/admin/events/camille-et-sacha' },
  )

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
    expect(screen.getByText(fr.admin.qrScanPrompt)).toBeVisible()
  })

  it('keeps the printed page to the QR card: the other two columns are for the screen only', async () => {
    const { container } = renderPage(fakeApi())
    await screen.findByRole('heading', { name: 'Camille & Sacha' })

    // The card for the tables is what the host prints; the join code's controls and the guest
    // list have nothing to say on paper, and `screenOnly` is what hides them there.
    const columns = [...container.querySelectorAll('div')].filter((element) =>
      classesOf(element).includes(cls(styles, 'column')),
    )
    expect(columns.map((column) => classesOf(column).includes(cls(styles, 'screenOnly')))).toEqual([
      true,
      false,
      true,
    ])
  })

  it('links to the wall, the moderation console, the settings and the album', async () => {
    renderPage(fakeApi())

    expect(await screen.findByRole('link', { name: fr.admin.openWall })).toHaveAttribute(
      'href',
      '/e/camille-et-sacha/display',
    )
    expect(screen.getByRole('link', { name: fr.admin.openModeration })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/moderation',
    )
    // The phone console. Reachable from here or not at all: the host who wants it has
    // walked away from the laptop, and an address they have to type is one nobody uses.
    expect(screen.getByRole('link', { name: fr.mobileModeration.title })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/moderation/mobile',
    )
    expect(screen.getByRole('link', { name: fr.admin.settings })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/settings',
    )
    // Built by the API client, so the ZIP link and the endpoint cannot drift apart.
    expect(screen.getByRole('link', { name: fr.admin.download })).toHaveAttribute(
      'href',
      '/api/events/camille-et-sacha/album.zip',
    )
  })

  it('shows the storage used against the quota the event actually has', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ usedBytes: 2_400_000, quotaBytes: 5_000_000_000 })),
    })

    renderPage(api)

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

    renderPage(api)

    const bar = await screen.findByRole('progressbar', { name: fr.admin.storageLabel })
    expect(bar).toHaveAttribute('aria-valuemax', '2000')
  })

  it('says when the live window of a client’s event closes, and says nothing when it has none', async () => {
    const closing = '2026-06-23T18:00:00.000Z'
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ liveWindowEnd: closing })),
    })

    renderPage(api)

    expect(
      await screen.findByText(
        fr.clientSpace.liveWindowEnd(formatDateTime(closing, 'fr') ?? closing),
      ),
    ).toBeVisible()
  })

  it('has no live window line for an event that has none', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto()) }))

    await screen.findByRole('progressbar', { name: fr.admin.storageLabel })
    expect(screen.queryByText(/Le direct se termine/)).toBeNull()
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

      const heading = screen.getByRole('heading', { name: fr.admin.qrCode })
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
    expect(await screen.findByText(fr.admin.statusClosed)).toBeVisible()
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

  it('leaves a closed event alone when the archive dialog is cancelled', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'closed' })) })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.archiveEvent }))
    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(api.setEventStatus).not.toHaveBeenCalled()
    expect(screen.getByText(fr.admin.statusClosed)).toBeVisible()
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
    // Both consoles, or neither: an archived event takes no decisions, and a second
    // address into the same queue would be a second way to find that out the hard way.
    expect(screen.queryByRole('link', { name: fr.mobileModeration.title })).toBeNull()
    // The code cannot be rotated on an immutable event, so the button is not offered.
    expect(screen.queryByRole('button', { name: fr.admin.rotateJoinCode })).toBeNull()
  })

  it('gives the owner the shared gallery link, on the event it belongs to', async () => {
    const api = fakeApi()

    renderPage(api)

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

    renderPage(api)
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

    renderPage(api)
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
    expect(await screen.findByText(fr.admin.statusLive)).toBeVisible()
    expect(screen.getByText(fr.admin.noticeOpened)).toBeVisible()
  })

  it('does not open a draft to guests when the host backs out of the question', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'draft' })) })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.goLive }))
    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(api.setEventStatus).not.toHaveBeenCalled()
    expect(screen.getByText(fr.admin.statusDraft)).toBeVisible()
  })

  it('offers the screen from a draft, which waits for the opening', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'draft' })) })

    renderPage(api)

    const wall = await screen.findByRole('link', { name: fr.admin.openWall })
    expect(wall).toHaveAttribute('href', '/e/camille-et-sacha/display')
    expect(within(wall).getByText(fr.admin.wallDraftHint)).toBeVisible()
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
    expect(screen.getByText(fr.admin.statusLive)).toBeVisible()
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

    renderPage(api)
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
describe('EventPage, after the evening', () => {
  const renderClosed = (
    status: 'closed' | 'archived' = 'closed',
    role: 'owner' | 'moderator' = 'owner',
  ) => renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto({ status, role })) }))

  it('leads a closed event with the album, before the code and the controls', async () => {
    renderClosed()

    const after = await screen.findByRole('heading', { name: fr.admin.afterTitle })
    const code = screen.getByRole('heading', { name: fr.admin.joinCode })
    const controls = screen.getByRole('heading', { name: fr.admin.eventControls })
    expect(after.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(after.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('leads an archived event with the album too', async () => {
    renderClosed('archived')

    expect(await screen.findByRole('heading', { name: fr.admin.afterTitle })).toBeVisible()
  })

  it('has no such card while the event is a draft or live', async () => {
    renderPage(fakeApi())

    await screen.findByRole('heading', { name: 'Camille & Sacha' })
    expect(screen.queryByRole('heading', { name: fr.admin.afterTitle })).toBeNull()
  })

  it('offers the album download in the card', async () => {
    renderClosed()

    const card = (await screen.findByRole('heading', { name: fr.admin.afterTitle })).closest(
      'section',
    )
    if (card === null) throw new Error('the card is not a section')
    expect(within(card).getByRole('link', { name: fr.admin.download })).toHaveAttribute('download')
  })

  it('takes the owner to the album link panel from the card', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView']
    try {
      renderClosed()

      await userEvent.click(await screen.findByRole('button', { name: fr.admin.afterShare }))

      const panel = screen.getByRole('heading', { name: fr.admin.shareLink })
      expect(scrollIntoView.mock.contexts[0]).toBe(panel)
      expect(panel).toHaveFocus()
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('offers a moderator the download but no way to make the link, which is the owner’s', async () => {
    renderClosed('closed', 'moderator')

    await screen.findByRole('heading', { name: fr.admin.afterTitle })
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

    expect(await screen.findByText(/Fermeture automatique/)).toBeVisible()
  })

  it('shows nothing when no schedule is armed', async () => {
    draftWith({})

    await screen.findByRole('heading', { name: 'Camille & Sacha' })
    expect(screen.queryByText(/automatique/)).toBeNull()
  })

  it('warns, at the top of the page, that the sweep threw the schedule away', async () => {
    draftWith({ scheduleDiscardedAt: '2031-06-20T16:00:00.000Z' })

    await screen.findByRole('heading', { name: 'Camille & Sacha' })
    const warning = screen.getByText(/n’a pas pu s’appliquer/).closest('[role="status"]')
    if (warning === null) throw new Error('the warning is not a status')
    expect(warning).toHaveAttribute('role', 'status')
    expect(within(warning).getByRole('link', { name: fr.admin.autoEdit })).toBeVisible()
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
    await screen.findByText(fr.admin.statusClosed)
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
    // One `EventPage` instance serves every `/admin/events/:slug`: React Router keeps it
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
        <Routes>
          <Route path="/admin/events/:slug" element={<EventPage />} />
        </Routes>
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
