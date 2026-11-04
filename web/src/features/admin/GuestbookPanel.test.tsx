import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
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
  it('sends the host to the console instead of deciding here', async () => {
    render(fakeApi({ guestbookQueue: vi.fn(async () => queue([item()], 1)) }))

    const link = await screen.findByRole('link', { name: fr.guestbookHost.openMessages })
    expect(link.getAttribute('href')).toBe('/admin/events/' + SLUG + '/moderation?vue=messages')
    expect(screen.getByText(fr.guestbookHost.pending(1))).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.moderation.publishPhoto('Léa') })).toBeNull()
  })

  it('counts the messages on screen in its summary', async () => {
    const published = item({
      id: 'gb-2',
      status: 'published',
      allowedDecisions: ['hide', 'reject'],
    })
    render(fakeApi({ guestbookQueue: vi.fn(async () => queue([item(), published], 1)) }))

    expect(await screen.findByText(fr.guestbookHost.onWall(1))).toBeVisible()
  })

  it('keeps reading the book, without any decision, once the event can no longer be moderated', async () => {
    render(fakeApi({ guestbookQueue: vi.fn(async () => queue([item()], 1)) }), false)

    expect(await screen.findByText('Une belle soirée')).toBeVisible()
    expect(screen.getByText('Léa')).toBeVisible()
    expect(screen.getByText(fr.guestbookHost.statusPending)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.moderation.publishPhoto('Léa') })).toBeNull()
    expect(screen.queryByRole('link', { name: fr.guestbookHost.openMessages })).toBeNull()
  })

  it('names a guest with no name in the read-only book', async () => {
    render(
      fakeApi({ guestbookQueue: vi.fn(async () => queue([item({ authorName: null })])) }),
      false,
    )

    expect(await screen.findByText(fr.guestbookHost.anonymous)).toBeVisible()
  })

  it('says the read-only book is empty', async () => {
    render(fakeApi(), false)

    expect(await screen.findByText(fr.guestbookHost.empty)).toBeVisible()
  })

  it('copies the id of a message from the read-only book', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(fakeApi({ guestbookQueue: vi.fn(async () => queue([item()], 1)) }), false)

    await userEvent.click(await screen.findByRole('button', { name: new RegExp('gb-1') }))

    expect(writeText).toHaveBeenCalledWith('gb-1')
    expect(await screen.findByText(fr.guestbookHost.idCopied)).toBeVisible()
  })
})
