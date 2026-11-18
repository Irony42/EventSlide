import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ApiProvider } from '../../../lib/ApiProvider'
import { fakeApi } from '../../../testing/renderWithProviders'
import {
  POLL_EVERY_MS,
  POLL_SLOW_AFTER_MS,
  POLL_SLOW_EVERY_MS,
  POLL_VOICE_EVERY_MS,
  POLL_VOICE_FAST_FOR_MS,
  POLL_VOICE_JITTER_MS,
} from './pollCadence'
import { useMyMessages } from './useMyMessages'
import type { ReactNode } from 'react'
import type { Api } from '../../../lib/api/client'
import type { GuestbookEntryDto } from '../../../lib/api/dto'

/**
 * How often a guest's own messages are read again (spec 25): by a timer, and only while a voice message
 * of theirs is being processed. Nothing is pushed to a phone, and a guest with nothing in flight is
 * never polled.
 */

const SLUG = 'camille-et-sacha'

const aVoice = (
  state: 'reserved' | 'queued' | 'running' | 'ready' | 'failed',
  id = 'v',
): GuestbookEntryDto => ({
  id,
  text: null,
  status: 'pending',
  createdAt: '',
  canDelete: true,
  voice: { state, durationMs: state === 'ready' ? 5_000 : null, caption: null },
})

const wrapperFor = (api: Api) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <ApiProvider api={api}>{children}</ApiProvider>
  }

const apiAnswering = (...answers: readonly (readonly GuestbookEntryDto[])[]): Api => {
  let call = 0
  return fakeApi({
    myGuestbook: vi.fn(async () => {
      const items = answers[Math.min(call, answers.length - 1)] ?? []
      call += 1
      return { items, accepting: true, onWall: true, voiceAvailable: true, voiceMaxSeconds: 60 }
    }),
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  // The middle of every jitter: no shift at all, so the cadence is the number itself.
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const run = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

/** Time passing in steps, so each answer is rendered, and the next read armed, before the next step. */
const pass = async (ms: number, step = 1_000) => {
  for (let elapsed = 0; elapsed < ms; elapsed += step) await run(step)
}

const mount = async (api: Api) => {
  const hook = renderHook(() => useMyMessages(SLUG, true), { wrapper: wrapperFor(api) })
  await run(0)
  return hook
}

describe('useMyMessages, the voice in flight', () => {
  it('never reads again by itself when no voice of the guest is being processed', async () => {
    const api = apiAnswering([aVoice('ready')])
    await mount(api)

    await run(10 * 60_000)

    // One read, at mount, and nothing for ten minutes: "En traitement" is the only state that
    // changes without the guest doing anything.
    expect(api.myGuestbook).toHaveBeenCalledTimes(1)
  })

  it('reads again every three seconds while a voice is queued, and stops once it is ready', async () => {
    const api = apiAnswering([aVoice('queued')], [aVoice('running')], [aVoice('ready')])
    await mount(api)
    expect(api.myGuestbook).toHaveBeenCalledTimes(1)

    await run(POLL_VOICE_EVERY_MS - 1)
    expect(api.myGuestbook).toHaveBeenCalledTimes(1)
    await run(1)
    expect(api.myGuestbook).toHaveBeenCalledTimes(2)
    await run(POLL_VOICE_EVERY_MS)
    expect(api.myGuestbook).toHaveBeenCalledTimes(3)

    // Ready: nothing is waiting any more, so nothing is asked.
    await run(5 * 60_000)
    expect(api.myGuestbook).toHaveBeenCalledTimes(3)
  })

  it.each(['reserved', 'queued', 'running'] as const)(
    'polls while a voice is %s, the three states a recording is still being processed in',
    async (state) => {
      const api = apiAnswering([aVoice(state)], [aVoice('ready')])
      await mount(api)

      await run(POLL_VOICE_EVERY_MS)

      expect(api.myGuestbook).toHaveBeenCalledTimes(2)
    },
  )

  it('keeps polling after a read that failed: a phone that lost the network for a moment is not left on "En traitement"', async () => {
    let call = 0
    const api = fakeApi({
      myGuestbook: vi.fn(async () => {
        call += 1
        if (call === 2) throw new TypeError('Failed to fetch')
        return {
          items: [aVoice(call < 4 ? 'queued' : 'ready')],
          accepting: true,
          onWall: true,
          voiceAvailable: true,
          voiceMaxSeconds: 60,
        }
      }),
    })
    const { result } = await mount(api)

    await pass(30_000)

    // The failed read (the second) did not end the timer: the third and fourth went out, and the
    // fourth found the voice ready, which is what stopped it.
    expect(api.myGuestbook).toHaveBeenCalledTimes(4)
    expect(result.current.items[0]?.voice?.state).toBe('ready')
  })

  it('spreads the short cadence by a second either way', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const api = apiAnswering([aVoice('queued')])
    await mount(api)

    await run(POLL_VOICE_EVERY_MS - POLL_VOICE_JITTER_MS)

    expect(api.myGuestbook).toHaveBeenCalledTimes(2)
  })

  it('goes back to the ordinary nine seconds after a minute, and does not stay at three', async () => {
    const api = apiAnswering([aVoice('queued')])
    await mount(api)
    await pass(POLL_VOICE_FAST_FOR_MS)
    const afterFirstMinute = vi.mocked(api.myGuestbook).mock.calls.length
    // Three seconds a read for sixty seconds: twenty reads, give or take the boundary.
    expect(afterFirstMinute).toBeGreaterThanOrEqual(19)

    await run(POLL_EVERY_MS - 1)
    expect(api.myGuestbook).toHaveBeenCalledTimes(afterFirstMinute)
    await run(1)
    expect(api.myGuestbook).toHaveBeenCalledTimes(afterFirstMinute + 1)
  })

  it('slows to thirty seconds after five minutes of waiting, as the photo poll does', async () => {
    const stamps: number[] = []
    const api = fakeApi({
      myGuestbook: vi.fn(async () => {
        stamps.push(Date.now())
        return {
          items: [aVoice('running')],
          accepting: true,
          onWall: true,
          voiceAvailable: true,
          voiceMaxSeconds: 60,
        }
      }),
    })
    await mount(api)

    await pass(POLL_SLOW_AFTER_MS + 120_000)

    const gaps = stamps.slice(1).map((stamp, index) => stamp - (stamps[index] ?? 0))
    // Nine seconds at first, thirty at the end, and never anything in between or beyond.
    expect(gaps[0]).toBeLessThanOrEqual(POLL_VOICE_EVERY_MS + 1_000)
    expect(gaps.at(-1)).toBe(POLL_SLOW_EVERY_MS)
    expect(gaps.at(-2)).toBe(POLL_SLOW_EVERY_MS)
  })

  it('does not poll for a failed voice: there is nothing left to wait for', async () => {
    const api = apiAnswering([aVoice('failed')])
    await mount(api)

    await run(5 * 60_000)

    expect(api.myGuestbook).toHaveBeenCalledTimes(1)
  })

  it('does not poll for a written message', async () => {
    const written: GuestbookEntryDto = {
      id: 'w',
      text: 'Un mot',
      status: 'pending',
      createdAt: '',
      canDelete: true,
      voice: null,
    }
    const api = apiAnswering([written])
    await mount(api)

    await run(5 * 60_000)

    expect(api.myGuestbook).toHaveBeenCalledTimes(1)
  })

  it('stops polling when the screen is left', async () => {
    const api = apiAnswering([aVoice('queued')])
    const { unmount } = await mount(api)
    unmount()

    await run(60_000)

    expect(api.myGuestbook).toHaveBeenCalledTimes(1)
  })

  it('says whether a voice message would be taken now', async () => {
    const { result } = await mount(apiAnswering([]))

    expect(result.current.voiceAvailable).toBe(true)
  })
})
