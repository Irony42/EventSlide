import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { MessageSwipeCard } from './MessageSwipeCard'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import type { GuestbookQueueItemDto } from '../../../lib/api/dto'

/**
 * A voice on the swipe card (spec 25): the player's own drag is not a swipe.
 * `fireEvent` for the same reason as in `SwipeCard.test.tsx`: the coordinates are the subject.
 */
const aVoice: GuestbookQueueItemDto = {
  id: 'v1',
  text: null,
  authorName: 'Camille',
  status: 'pending',
  createdAt: '2026-11-04T20:00:00.000Z',
  allowedDecisions: ['publish', 'reject'],
  voice: { state: 'ready', durationMs: 23_000, bytes: 187_000, caption: null },
}

const swipeRight = (target: Element): void => {
  fireEvent.pointerDown(target, {
    pointerId: 1,
    button: 0,
    isPrimary: true,
    clientX: 0,
    clientY: 0,
  })
  fireEvent.pointerMove(target, { pointerId: 1, clientX: 40, clientY: 0 })
  fireEvent.pointerMove(target, { pointerId: 1, clientX: 120, clientY: 0 })
  fireEvent.pointerUp(target, { pointerId: 1, clientX: 120, clientY: 0 })
}

describe('MessageSwipeCard, a voice', () => {
  it('does not take a drag on the player for a swipe', () => {
    const onDecide = vi.fn()
    renderWithProviders(<MessageSwipeCard slug="s" message={aVoice} onDecide={onDecide} />)

    swipeRight(document.querySelector('audio') as Element)

    expect(onDecide).not.toHaveBeenCalled()
  })

  it('still takes a drag on the rest of the card for a swipe', () => {
    const onDecide = vi.fn()
    renderWithProviders(<MessageSwipeCard slug="s" message={aVoice} onDecide={onDecide} />)

    swipeRight(screen.getByTestId('mobile-moderation-card'))

    expect(onDecide).toHaveBeenCalledWith('publish', 'v1')
  })
})
