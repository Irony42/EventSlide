import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ApiProvider } from '../../../lib/ApiProvider'
import { SessionProvider } from '../../../lib/SessionProvider'
import { aSessionUser, fakeApi } from '../../../testing/renderWithProviders'
import type { EventStatus } from '../../../lib/api/dto'
import { flushPromises } from '../../../testing/flushPromises'
import { useEventTour } from './useEventTour'

type Facts = { readonly status: EventStatus; readonly pendingCount: number }

const mount = (initial: Facts) => {
  const api = fakeApi({
    session: vi.fn(async () => ({
      authenticated: true as const,
      user: aSessionUser({ toursSeen: [] }),
    })),
  })
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <ApiProvider api={api}>
      <SessionProvider scope="test">{children}</SessionProvider>
    </ApiProvider>
  )
  return renderHook((facts: Facts) => useEventTour(facts), { wrapper, initialProps: initial })
}

describe('useEventTour', () => {
  it('stays open when a photo arrives while the host is reading it', async () => {
    const { result, rerender } = mount({ status: 'live', pendingCount: 0 })
    await waitFor(() => expect(result.current.open).toBe(true))

    rerender({ status: 'live', pendingCount: 3 })

    expect(result.current.open).toBe(true)
  })

  it('does not pop up over a queue the host has just emptied', async () => {
    const { result, rerender } = mount({ status: 'live', pendingCount: 4 })
    // The session is read: the arrival is decided, and it said no.
    await flushPromises()
    expect(result.current.open).toBe(false)

    rerender({ status: 'live', pendingCount: 0 })

    expect(result.current.open).toBe(false)
  })
})
