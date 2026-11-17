import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ApiProvider } from '../../../lib/ApiProvider'
import { aGuestPhoto, fakeApi } from '../../../testing/renderWithProviders'
import { REVEAL_NOW_MS, aRevealBlock } from '../../../testing/revealFixtures'
import { useMyPhotos } from './useMyPhotos'
import type { Api } from '../../../lib/api/client'
import type { GuestPhotoDto, MyPhotosDto } from '../../../lib/api/dto'

/**
 * The phone's half of a disposable-camera evening (spec 23): the roll and the gate it reads, the
 * read at the hour that nobody announces, and the moment the photographs are developed.
 *
 * The hour sends no signal, so what is pinned is when the phone asks again, on whose clock, and
 * what it tells the guest when the answer is different.
 */

const SLUG = 'camille-et-sacha'

let visibility: 'visible' | 'hidden' = 'visible'

const setVisibility = (next: 'visible' | 'hidden') => {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

const veiled = (id: string): GuestPhotoDto =>
  aGuestPhoto({ id, status: 'published', awaitsReveal: true })
const developed = (id: string): GuestPhotoDto =>
  aGuestPhoto({ id, status: 'published', awaitsReveal: false })

/** Answers each read with the next answer, repeating the last once they run out. */
const serving = (...answers: readonly MyPhotosDto[]) => {
  let read = 0
  const myPhotos = vi.fn(async () => {
    const answer = answers[Math.min(read, answers.length - 1)] ?? { items: [] }
    read += 1
    return answer
  })
  return { api: fakeApi({ myPhotos }), myPhotos }
}

const mount = (api: Api) => {
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <ApiProvider api={api}>{children}</ApiProvider>
  )
  return renderHook(() => useMyPhotos(SLUG), { wrapper })
}

/** One-second steps, each settled, as a phone sees time pass. */
const elapse = async (ms: number) => {
  for (let left = ms; left > 0; left -= 1_000) {
    await act(() => vi.advanceTimersByTimeAsync(Math.min(1_000, left)))
  }
  if (ms === 0) await act(() => vi.advanceTimersByTimeAsync(0))
}

const mounted = async (api: Api) => {
  const view = mount(api)
  await elapse(0)
  return view
}

/** A held evening whose hour is `inMs` away on the server's clock. */
const held = (inMs: number | null) =>
  aRevealBlock({ atMs: inMs === null ? null : REVEAL_NOW_MS + inMs })

const revealed = aRevealBlock({ revealed: true, atMs: REVEAL_NOW_MS - 1_000 })

describe('the roll and the gate on the guest’s own list', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
    // No draw: the jitter is 0 and a poll's own shift is its earliest.
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('hands the screen the roll, the gate and the gap between the server’s clock and its own', async () => {
    const { api } = serving({
      items: [veiled('a')],
      shots: { max: 27, taken: 1 },
      reveal: aRevealBlock({ serverNowMs: Date.now() + 60_000 }),
    })
    const { result } = await mounted(api)

    expect(result.current.shots).toEqual({ max: 27, taken: 1 })
    expect(result.current.reveal?.enabled).toBe(true)
    // The server is a minute ahead of this phone: that is what a countdown is measured with.
    expect(result.current.offsetMs).toBeGreaterThan(59_000)
    expect(result.current.offsetMs).toBeLessThan(61_000)
  })

  it('has no roll and no gate for a server that predates them', async () => {
    const { api } = serving({ items: [developed('a')] })
    const { result } = await mounted(api)

    expect(result.current.shots).toBeNull()
    expect(result.current.reveal).toBeNull()
  })

  describe('reading again at the hour', () => {
    // Hidden: the guest's poll is asleep, so the only read besides the first is the hour's.
    beforeEach(() => {
      visibility = 'hidden'
    })

    it('asks again when the hour of the answer comes, and not before', async () => {
      const { api, myPhotos } = serving({ items: [veiled('a')], reveal: held(60_000) })
      await mounted(api)
      expect(myPhotos).toHaveBeenCalledTimes(1)

      await elapse(59_000)
      expect(myPhotos).toHaveBeenCalledTimes(1)
      await elapse(1_000)
      expect(myPhotos).toHaveBeenCalledTimes(2)
    })

    it('draws a delay of up to three seconds, so two hundred phones do not ask in the same millisecond', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99)
      const { api, myPhotos } = serving({ items: [veiled('a')], reveal: held(60_000) })
      await mounted(api)

      await elapse(61_000)
      expect(myPhotos).toHaveBeenCalledTimes(1)
      await elapse(3_000)
      expect(myPhotos).toHaveBeenCalledTimes(2)
    })

    it('does not set a timer for a reveal by hand: the hour is not known, and no read is spent on it', async () => {
      const { api, myPhotos } = serving({ items: [veiled('a')], reveal: held(null) })
      await mounted(api)

      await elapse(120_000)
      expect(myPhotos).toHaveBeenCalledTimes(1)
    })

    it('sets no timer for an evening that is not held', async () => {
      const { api, myPhotos } = serving({ items: [developed('a')], reveal: revealed })
      await mounted(api)

      await elapse(120_000)
      expect(myPhotos).toHaveBeenCalledTimes(1)
    })

    it('does not run on the phone’s own clock: the same wait whatever the phone thinks it is', async () => {
      const { api, myPhotos } = serving({ items: [veiled('a')], reveal: held(60_000) })
      vi.setSystemTime(Date.now() + 5 * 60_000)
      await mounted(api)

      await elapse(59_000)
      expect(myPhotos).toHaveBeenCalledTimes(1)
      await elapse(1_000)
      expect(myPhotos).toHaveBeenCalledTimes(2)
    })
  })

  describe('while the evening is held and the guest is looking', () => {
    it('keeps asking, because a reveal by hand has no hour to wait for', async () => {
      const { api, myPhotos } = serving({ items: [], reveal: held(null) })
      await mounted(api)
      expect(myPhotos).toHaveBeenCalledTimes(1)

      await elapse(12_000)
      expect(myPhotos.mock.calls.length).toBeGreaterThan(1)
    })

    it('does not ask for an evening that is revealed and has nothing waiting', async () => {
      const { api, myPhotos } = serving({ items: [developed('a')], reveal: revealed })
      await mounted(api)

      await elapse(60_000)
      expect(myPhotos).toHaveBeenCalledTimes(1)
    })

    it('stops asking once the answer says the evening is revealed', async () => {
      const { api, myPhotos } = serving(
        { items: [veiled('a')], reveal: held(null) },
        { items: [developed('a')], reveal: revealed },
      )
      await mounted(api)
      await elapse(12_000)
      const reads = myPhotos.mock.calls.length

      await elapse(60_000)
      expect(myPhotos).toHaveBeenCalledTimes(reads)
    })

    it('asks nothing while the tab is hidden, and once when the guest comes back', async () => {
      const { api, myPhotos } = serving({ items: [], reveal: held(null) })
      await mounted(api)
      setVisibility('hidden')
      await elapse(60_000)
      expect(myPhotos).toHaveBeenCalledTimes(1)

      setVisibility('visible')
      await elapse(0)
      expect(myPhotos).toHaveBeenCalledTimes(2)
    })
  })

  describe('the moment the photographs are developed', () => {
    it('counts the photographs that went from veiled to colour, and says it was watched', async () => {
      const { api } = serving(
        { items: [veiled('a'), veiled('b'), veiled('c')], reveal: held(null) },
        {
          items: [
            developed('a'),
            developed('b'),
            aGuestPhoto({ id: 'c', status: 'hidden', awaitsReveal: false }),
          ],
          reveal: revealed,
        },
      )
      const { result } = await mounted(api)
      expect(result.current.developed).toBeNull()

      await elapse(12_000)

      expect(result.current.developed).toEqual({ count: 2, whileAway: false })
    })

    it.each(['hidden', 'rejected'] as const)(
      'is not a development when the host makes a veiled photograph %s in a held evening',
      async (status) => {
        const { api } = serving(
          { items: [veiled('a'), veiled('b')], reveal: held(3_600_000) },
          {
            items: [aGuestPhoto({ id: 'a', status, awaitsReveal: false }), veiled('b')],
            reveal: held(3_600_000),
          },
        )
        const { result } = await mounted(api)

        await elapse(12_000)

        expect(result.current.developed).toBeNull()
      },
    )

    it('says nothing on a first sight of an evening already revealed: it is not a moment', async () => {
      const { api } = serving({ items: [developed('a'), developed('b')], reveal: revealed })
      const { result } = await mounted(api)

      expect(result.current.developed).toBeNull()
    })

    it('leaves by itself: a line that stayed an hour would be false', async () => {
      const { api } = serving(
        { items: [veiled('a')], reveal: held(null) },
        { items: [developed('a')], reveal: revealed },
      )
      const { result } = await mounted(api)
      await elapse(12_000)
      expect(result.current.developed).not.toBeNull()

      await elapse(16_000)

      expect(result.current.developed).toBeNull()
    })

    it('is not the host’s publication: a photograph published into a held evening is not "on the wall"', async () => {
      const vibrate = vi.fn(() => true)
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
      const { api } = serving(
        { items: [aGuestPhoto({ id: 'a', status: 'pending' })], reveal: held(null) },
        { items: [veiled('a')], reveal: held(null) },
      )
      const { result } = await mounted(api)

      await elapse(12_000)

      expect(result.current.arrival).toBeNull()
      expect(vibrate).not.toHaveBeenCalled()
    })

    it('is still the host’s publication on an evening that is not held', async () => {
      const { api } = serving(
        { items: [aGuestPhoto({ id: 'a', status: 'pending' })] },
        { items: [aGuestPhoto({ id: 'a', status: 'published' })] },
      )
      const { result } = await mounted(api)

      await elapse(12_000)

      expect(result.current.arrival).not.toBeNull()
    })
  })
})
