import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../../lib/ApiProvider'
import type { EventDto } from '../../../lib/api/dto'
import { ApiError } from '../../../lib/http'
import { anEventDto, fakeApi } from '../../../testing/renderWithProviders'
import { SAVE_DEBOUNCE_MS, usePanelSettings } from './usePanelSettings'

interface Deferred {
  readonly resolve: (event: EventDto) => void
  readonly reject: (cause: unknown) => void
}

/** An API whose every `updateSettings` waits for the test to answer it, in any order. */
const slowApi = () => {
  const answers: Deferred[] = []
  const updateSettings = vi.fn(
    () =>
      new Promise<EventDto>((resolve, reject) => {
        answers.push({ resolve, reject })
      }),
  )
  return { api: fakeApi({ updateSettings }), answers, updateSettings }
}

const setup = () => {
  const event = anEventDto()
  const { api, answers, updateSettings } = slowApi()
  const replace = vi.fn()
  const hook = renderHook(() => usePanelSettings(event.slug, event, replace), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ApiProvider api={api}>{children}</ApiProvider>
    ),
  })
  const flush = () => act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS))
  return { ...hook, event, answers, updateSettings, replace, flush }
}

/**
 * BUG-23: the answer to save N used to empty the whole optimistic overlay, including what
 * the host chose for save N+1 while N was in flight, and a refusal of N did the same while
 * N+1 was still queued and went out anyway.
 */
describe('the panel saves, numbered (BUG-23)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps showing the choice of save N+1 when the answer to N arrives first', async () => {
    const t = setup()
    const before = t.event.settings.guestbookOnWall
    act(() => t.result.current.save({ wallLanguage: 'de' }))
    await t.flush()
    act(() => t.result.current.save({ guestbookOnWall: !before }))
    await t.flush()
    expect(t.updateSettings).toHaveBeenCalledTimes(2)

    await act(async () => {
      t.answers[0]?.resolve({
        ...t.event,
        settings: { ...t.event.settings, wallLanguage: 'de' },
      })
    })

    expect(t.result.current.settings.guestbookOnWall).toBe(!before)
  })

  it('takes back only what the refused save held, and still sends the queued one', async () => {
    const t = setup()
    const before = t.event.settings.guestbookOnWall
    act(() => t.result.current.save({ wallLanguage: 'de' }))
    await t.flush()
    act(() => t.result.current.save({ guestbookOnWall: !before }))

    await act(async () => {
      t.answers[0]?.reject(new ApiError(422, 'validation.failed'))
    })

    expect(t.result.current.settings.wallLanguage).toBe(t.event.settings.wallLanguage)
    expect(t.result.current.settings.guestbookOnWall).toBe(!before)
    expect(t.result.current.state.kind).toBe('failed')
    await t.flush()
    expect(t.updateSettings).toHaveBeenLastCalledWith(t.event.slug, { guestbookOnWall: !before })
  })

  it('does not say "saved" while a later save is still on its way', async () => {
    const t = setup()
    act(() => t.result.current.save({ wallLanguage: 'de' }))
    await t.flush()
    act(() => t.result.current.save({ guestbookOnWall: false }))
    await t.flush()

    await act(async () => {
      t.answers[0]?.resolve(t.event)
    })

    expect(t.result.current.state.kind).toBe('saving')
  })

  it('keeps saying a save was refused when a later one is accepted', async () => {
    const t = setup()
    act(() => t.result.current.save({ wallLanguage: 'de' }))
    await t.flush()
    act(() => t.result.current.save({ guestbookOnWall: false }))
    await t.flush()

    await act(async () => {
      t.answers[0]?.reject(new ApiError(422, 'validation.failed'))
    })
    await act(async () => {
      t.answers[1]?.resolve(t.event)
    })

    expect(t.result.current.state.kind).toBe('failed')
  })
})
