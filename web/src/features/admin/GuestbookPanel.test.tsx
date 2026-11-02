import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { GuestbookPanel } from './GuestbookPanel'
import type { Api } from '../../lib/api/client'
import type { GuestbookQueueDto, GuestbookQueueItemDto } from '../../lib/api/dto'

const SLUG = 'camille-et-sacha'

const item = (over: Partial<GuestbookQueueItemDto> = {}): GuestbookQueueItemDto => ({
  id: 'gb-1',
  text: 'Une belle soirée',
  authorName: 'Léa',
  status: 'pending',
  createdAt: '2026-11-01T20:00:00.000Z',
  allowedDecisions: ['publish', 'reject'],
  ...over,
})

const queue = (items: readonly GuestbookQueueItemDto[], pendingCount = 0): GuestbookQueueDto => ({
  items,
  pendingCount,
})

const render = (api: Api, canDecide = true) =>
  renderWithProviders(<GuestbookPanel slug={SLUG} canDecide={canDecide} />, { api })

describe('GuestbookPanel', () => {
  it('says the book is empty', async () => {
    render(fakeApi())

    expect(await screen.findByText(fr.guestbookHost.empty)).toBeVisible()
  })

  it('shows each message with its author, status, id and the pending count', async () => {
    render(fakeApi({ guestbookQueue: vi.fn(async () => queue([item()], 1)) }))

    expect(await screen.findByText('Une belle soirée')).toBeVisible()
    expect(screen.getByText('Léa')).toBeVisible()
    expect(screen.getByText(fr.guestbookHost.statusPending)).toBeVisible()
    expect(screen.getByText(fr.guestbookHost.pending(1))).toBeVisible()
    expect(screen.getByRole('button', { name: new RegExp('gb-1') })).toBeVisible()
  })

  it('names a guest with no name', async () => {
    render(fakeApi({ guestbookQueue: vi.fn(async () => queue([item({ authorName: null })])) }))

    expect(await screen.findByText(fr.guestbookHost.anonymous)).toBeVisible()
  })

  it('offers exactly the decisions the server allows, and sends the one pressed', async () => {
    const decideGuestbookEntry = vi.fn(async () => undefined)
    const guestbookQueue = vi.fn(async () => queue([item()], 1))
    render(fakeApi({ guestbookQueue, decideGuestbookEntry }))

    await screen.findByText('Une belle soirée')
    expect(screen.queryByRole('button', { name: new RegExp(fr.moderation.hide) })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: fr.moderation.publishPhoto('Léa') }))

    await waitFor(() => expect(decideGuestbookEntry).toHaveBeenCalledWith(SLUG, 'gb-1', 'publish'))
    await waitFor(() => expect(guestbookQueue).toHaveBeenCalledTimes(2))
  })

  it('offers no decision on an event that can no longer be moderated', async () => {
    render(fakeApi({ guestbookQueue: vi.fn(async () => queue([item()], 1)) }), false)

    await screen.findByText('Une belle soirée')
    expect(screen.queryByRole('button', { name: fr.moderation.publishPhoto('Léa') })).toBeNull()
  })

  it('copies the id of a message', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(fakeApi({ guestbookQueue: vi.fn(async () => queue([item()], 1)) }))

    await userEvent.click(await screen.findByRole('button', { name: new RegExp('gb-1') }))

    expect(writeText).toHaveBeenCalledWith('gb-1')
    expect(await screen.findByText(fr.guestbookHost.idCopied)).toBeVisible()
  })
})
