import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { EventPage } from './EventPage'
import { ApiError } from '../../lib/http'
import { formatBytes } from '../../lib/format'
import { fr } from '../../lib/i18n/fr'
import { anEventDto, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
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
        spaced(fr.admin.storageUsed(formatBytes(2_400_000), formatBytes(5_000_000_000))),
      ),
    ).toBeVisible()
  })

  it('asks before changing the join code, and says the connected guests stay connected', async () => {
    const api = fakeApi({
      rotateJoinCode: vi.fn(async () => anEventDto({ joinCode: 'ZX93PL' })),
    })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.rotateJoinCode }))

    expect(screen.getByText(fr.admin.rotateJoinCodeTitle)).toBeVisible()
    // The thing a host is actually afraid of, answered before they commit.
    expect(screen.getByText(fr.admin.rotateJoinCodeHint)).toBeVisible()
    expect(api.rotateJoinCode).not.toHaveBeenCalled()

    await userEvent.click(inDialog(fr.admin.rotateJoinCode))

    expect(api.rotateJoinCode).toHaveBeenCalledWith('camille-et-sacha')
    expect(await screen.findByText(fr.admin.codeRotated)).toBeVisible()
    // The new code comes from the answer, not from anything guessed locally.
    expect(screen.getAllByText('ZX93PL').length).toBeGreaterThan(0)
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

  it('hides the owner-only controls from a moderator', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })) })

    renderPage(api)

    expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    // Every moderator endpoint requires an owner, so the panel is not rendered at all
    // rather than shown with every request coming back 403.
    expect(screen.queryByRole('heading', { name: fr.admin.moderators })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.purge })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.rotateJoinCode })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.closeEvent })).toBeNull()
    // Moderating is still their job.
    expect(screen.getByRole('link', { name: fr.admin.openModeration })).toBeVisible()
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

    expect(api.setEventStatus).toHaveBeenCalledWith('camille-et-sacha', 'live')
    expect(await screen.findByText(fr.admin.statusLive)).toBeVisible()
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
