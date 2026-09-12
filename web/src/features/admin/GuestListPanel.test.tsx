import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestListPanel } from './GuestListPanel'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { GuestDto, GuestListResponse } from '../../lib/api/dto'

/** The harness has no guest factory: `GET /api/events/:slug/guests` answers with these. */
const aGuest = (overrides: Partial<GuestDto> = {}): GuestDto => ({
  id: 'guest-1',
  displayName: 'Léa',
  joinedAt: '2026-06-20T20:15:00.000Z',
  lastSeenAt: '2026-06-20T21:04:11.031Z',
  photoCount: 4,
  revoked: false,
  ...overrides,
})

const renderPanel = (api: Api, canRevoke = true) =>
  renderWithProviders(<GuestListPanel slug="camille-et-sacha" canRevoke={canRevoke} />, {
    api,
    route: '/admin/events/camille-et-sacha',
  })

/**
 * The confirmation's own button, which carries the same label as the row's.
 *
 * `noUncheckedIndexedAccess`: an empty list here would be a broken test rather than a
 * component fault, so it fails loudly instead of clicking `undefined`.
 */
const lastRevokeButton = (): HTMLElement => {
  const buttons = screen.getAllByRole('button', { name: fr.admin.revokeGuest })
  const last = buttons[buttons.length - 1]
  if (last === undefined) throw new Error('no revoke button')
  return last
}

describe('GuestListPanel', () => {
  it('says it is working while the guests load', () => {
    const api = fakeApi({ listGuests: vi.fn(() => new Promise<GuestListResponse>(() => {})) })

    renderPanel(api)

    expect(screen.getByRole('status')).toHaveTextContent(fr.app.loading)
  })

  it('explains an empty list rather than showing nothing', async () => {
    renderPanel(fakeApi())

    expect(await screen.findByText(fr.admin.guestsEmpty)).toBeVisible()
    expect(screen.getByText(fr.admin.guestsEmptyHint)).toBeVisible()
  })

  it('names the failure and offers a retry', async () => {
    const listGuests = vi.fn(async () => ({ items: [aGuest()], activeCount: 1 }))
    listGuests.mockRejectedValueOnce(ApiError.network())
    const api = fakeApi({ listGuests })

    renderPanel(api)

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByText('Léa')).toBeVisible()
  })

  it('lists each guest with their photo count and their last activity', async () => {
    const api = fakeApi({
      listGuests: vi.fn(async () => ({
        items: [aGuest(), aGuest({ id: 'guest-2', displayName: null, photoCount: 1 })],
        activeCount: 2,
      })),
    })

    renderPanel(api)

    expect(await screen.findByText('Léa')).toBeVisible()
    // Anonymity is a supported choice, not missing data.
    expect(screen.getByText(fr.moderation.byAnonymous)).toBeVisible()
    expect(screen.getByText(fr.admin.photos(4))).toBeVisible()
    expect(screen.getByText(fr.admin.photos(1))).toBeVisible()
    expect(screen.getAllByText(/Dernière activité/)).toHaveLength(2)
  })

  it('asks before removing a guest, and says what it does to their photos', async () => {
    const api = fakeApi({
      listGuests: vi.fn(async () => ({ items: [aGuest()], activeCount: 1 })),
    })

    renderPanel(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.revokeGuest }))

    expect(screen.getByText(fr.admin.revokeGuestTitle)).toBeVisible()
    expect(screen.getByText(fr.admin.revokeGuestHint)).toBeVisible()
    expect(api.revokeGuest).not.toHaveBeenCalled()

    // Two buttons carry the label now — the row and the dialog's confirm.
    await userEvent.click(lastRevokeButton())

    expect(api.revokeGuest).toHaveBeenCalledWith('camille-et-sacha', 'guest-1')
    expect(await screen.findByText(fr.admin.guestRevoked)).toBeVisible()
  })

  it('leaves the guest alone when the confirmation is cancelled', async () => {
    const api = fakeApi({
      listGuests: vi.fn(async () => ({ items: [aGuest()], activeCount: 1 })),
    })

    renderPanel(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.revokeGuest }))
    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(api.revokeGuest).not.toHaveBeenCalled()
    expect(screen.queryByText(fr.admin.revokeGuestTitle)).toBeNull()
  })

  it('marks a guest whose access is already gone instead of offering it again', async () => {
    const api = fakeApi({
      listGuests: vi.fn(async () => ({
        items: [aGuest({ revoked: true })],
        activeCount: 0,
      })),
    })

    renderPanel(api)

    expect(await screen.findByText(fr.admin.guestRevokedBadge)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.admin.revokeGuest })).toBeNull()
  })

  it('offers nothing to revoke on an archived event', async () => {
    const api = fakeApi({
      listGuests: vi.fn(async () => ({ items: [aGuest()], activeCount: 1 })),
    })

    renderPanel(api, false)

    expect(await screen.findByText('Léa')).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.admin.revokeGuest })).toBeNull()
  })

  it('reports a refused revoke instead of leaving the row looking changed', async () => {
    const api = fakeApi({
      listGuests: vi.fn(async () => ({ items: [aGuest()], activeCount: 1 })),
      revokeGuest: vi.fn(() => Promise.reject(new ApiError(403, 'auth.forbidden'))),
    })

    renderPanel(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.revokeGuest }))
    await userEvent.click(lastRevokeButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['auth.forbidden'])
  })

  it('says the date is unknown rather than printing an unreadable one', async () => {
    // The value crosses a trust boundary like any other server field. 1.0 rendered
    // `Invalid Date` in this column for every guest seeded by an older build.
    const api = fakeApi({
      listGuests: vi.fn(async () => ({
        items: [aGuest({ lastSeenAt: 'bientôt' })],
        activeCount: 1,
      })),
    })

    renderPanel(api)

    expect(await screen.findByText(fr.admin.lastSeen(fr.admin.dateUnknown))).toBeVisible()
  })
})
