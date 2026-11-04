import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aWallGuestbookMessage } from '../../../testing/renderWithProviders'
import { useWallGuestbook } from './useWallGuestbook'
import type { WallGuestbookDto } from '../../../lib/api/dto'

const BOOK: WallGuestbookDto = {
  everyNth: 3,
  messages: [
    aWallGuestbookMessage({ id: 'a', displayMs: 5_000 }),
    aWallGuestbookMessage({ id: 'b', displayMs: 5_000 }),
  ],
}

describe('useWallGuestbook', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const mount = (book: WallGuestbookDto | undefined) =>
    renderHook(({ generation, guestbook }) => useWallGuestbook(guestbook, generation), {
      initialProps: { generation: 0, guestbook: book },
    })

  it('shows nothing until the server’s Nth photograph change', () => {
    const view = mount(BOOK)

    view.rerender({ generation: 1, guestbook: BOOK })
    view.rerender({ generation: 2, guestbook: BOOK })

    expect(view.result.current.message).toBeNull()
  })

  it('shows the first message at the Nth change and takes it down after its own duration', () => {
    const view = mount(BOOK)

    view.rerender({ generation: 3, guestbook: BOOK })
    expect(view.result.current.message?.id).toBe('a')

    act(() => vi.advanceTimersByTime(4_999))
    expect(view.result.current.message?.id).toBe('a')
    act(() => vi.advanceTimersByTime(1))
    expect(view.result.current.message).toBeNull()
  })

  it('takes the card down at once when dismissed, and brings none back before the next Nth change', () => {
    const view = mount(BOOK)
    view.rerender({ generation: 3, guestbook: BOOK })
    expect(view.result.current.message?.id).toBe('a')

    act(() => view.result.current.dismiss())
    expect(view.result.current.message).toBeNull()

    act(() => vi.advanceTimersByTime(60_000))
    expect(view.result.current.message).toBeNull()
    view.rerender({ generation: 6, guestbook: BOOK })
    expect(view.result.current.message?.id).toBe('b')
  })

  it('goes round the messages and starts again at the first', () => {
    const view = mount(BOOK)
    const seen: (string | undefined)[] = []

    for (const generation of [3, 6, 9]) {
      view.rerender({ generation, guestbook: BOOK })
      seen.push(view.result.current.message?.id)
      act(() => vi.advanceTimersByTime(5_000))
    }

    expect(seen).toEqual(['a', 'b', 'a'])
  })

  it('shows nothing without a guestbook, or with no message', () => {
    const none = mount(undefined)
    none.rerender({ generation: 3, guestbook: undefined })
    expect(none.result.current.message).toBeNull()

    const empty = mount({ everyNth: 3, messages: [] })
    empty.rerender({ generation: 3, guestbook: { everyNth: 3, messages: [] } })
    expect(empty.result.current.message).toBeNull()
  })

  it('drops a card whose message left the response', () => {
    const view = mount(BOOK)
    view.rerender({ generation: 3, guestbook: BOOK })

    view.rerender({ generation: 3, guestbook: { everyNth: 3, messages: [BOOK.messages[1]!] } })

    expect(view.result.current.message).toBeNull()
  })
})
