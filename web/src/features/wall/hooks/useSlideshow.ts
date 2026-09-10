import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { WallItemDto } from '../../../lib/api/dto'
import { useTimingOverrides } from './useTimingOverrides'

export interface SlideshowOptions {
  readonly items: readonly WallItemDto[]
  /**
   * Milliseconds per slide, from the server. The wall never invents one: the interval
   * and the Ken Burns duration are derived from a single event setting in
   * `src/domain/slideshow/`, and a second opinion here is how 1.0's zoom ended up
   * outliving its slide.
   */
  readonly intervalMs: number
}

export interface Slideshow {
  readonly current: WallItemDto | null
  readonly next: WallItemDto | null
  /** The outgoing photo, kept whole so the crossfade has something to fade out. */
  readonly previous: WallItemDto | null
  readonly index: number
  /**
   * How many times the wall has changed photo. Monotonic, so the renderer can hand its
   * two recycled layers a stable slot each (`generation % 2`) instead of reordering
   * them — moving a DOM node restarts its CSS animation, which would jerk the outgoing
   * photo back to its start scale halfway through the crossfade.
   */
  readonly generation: number
  readonly paused: boolean
  readonly pause: () => void
  readonly resume: () => void
  /** One slide forward by default; the host's left arrow passes `-1`. */
  readonly advance: (step?: number) => void
}

/**
 * Where the wall is, as a photo rather than as a number.
 *
 * 1.0 kept the position as an index in `sessionStorage`, so two projectors on the same
 * event disagreed, and every publication shifted the list under the index — the room
 * saw the picture jump. Here the cursor is the id of the photo on screen: when the
 * playlist grows the same photo keeps the screen, and when it leaves the playlist the
 * wall falls back to the newest.
 */
interface Cursor {
  readonly currentId: string | null
  readonly previous: WallItemDto | null
  readonly generation: number
}

const INITIAL: Cursor = { currentId: null, previous: null, generation: 0 }

const subscribeVisibility = (onChange: () => void): (() => void) => {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

const isDocumentHidden = (): boolean => document.hidden

const neverHidden = (): boolean => false

/** Positive modulo, so stepping back from the first photo lands on the last. */
const wrap = (position: number, length: number): number => ((position % length) + length) % length

export const useSlideshow = ({ items, intervalMs }: SlideshowOptions): Slideshow => {
  const [cursor, setCursor] = useState<Cursor>(INITIAL)
  const [manuallyPaused, setManuallyPaused] = useState(false)

  /**
   * A hidden tab must not burn through the playlist.
   *
   * A projector that gets minimised for ten minutes would otherwise run four hundred
   * slides with nobody watching, and come back showing a photo from the middle of the
   * evening. `useSyncExternalStore` is how a browser value is read during render
   * without an effect that sets state.
   */
  const documentHidden = useSyncExternalStore(subscribeVisibility, isDocumentHidden, neverHidden)

  const { intervalMs: overrideMs } = useTimingOverrides()
  const effectiveIntervalMs = overrideMs ?? intervalMs

  const index = useMemo(() => {
    if (cursor.currentId === null) return 0
    const found = items.findIndex((item) => item.id === cursor.currentId)
    // The photo was rejected, hidden or deleted while it was on screen. The newest
    // photo is the safest landing place: it is the one a guest just sent.
    return found === -1 ? 0 : found
  }, [items, cursor.currentId])

  const current = items[index] ?? null
  const next = items.length === 0 ? null : (items[wrap(index + 1, items.length)] ?? null)

  const advance = useCallback(
    (step = 1) => {
      setCursor((previousCursor) => {
        if (items.length === 0) return previousCursor
        const from =
          previousCursor.currentId === null
            ? 0
            : items.findIndex((item) => item.id === previousCursor.currentId)
        const base = from === -1 ? 0 : from
        const target = items[wrap(base + step, items.length)]
        if (target === undefined) return previousCursor
        // Standing still is not a change: a one-photo wall must not keep bumping the
        // generation, or the two layers would swap slots with nothing to show.
        if (target.id === previousCursor.currentId) return previousCursor
        return {
          currentId: target.id,
          previous: items[base] ?? previousCursor.previous,
          generation: previousCursor.generation + 1,
        }
      })
    },
    [items],
  )

  /**
   * The timer calls the latest `advance` through a ref.
   *
   * `advance` is rebuilt whenever the playlist changes, and a busy cocktail hour
   * changes it every few seconds. If the interval depended on it, each publication
   * would restart the slide clock and a photo would keep being granted a fresh eight
   * seconds — on a fast enough event, the wall would never advance at all.
   */
  const advanceRef = useRef(advance)
  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  const paused = manuallyPaused || documentHidden
  const canAdvance = items.length > 1 && effectiveIntervalMs > 0
  const currentId = current?.id ?? null

  useEffect(() => {
    if (paused || !canAdvance || currentId === null) return

    const timer = window.setTimeout(() => advanceRef.current(1), effectiveIntervalMs)
    // Cleared on every re-run and on unmount. An eight-hour run that leaked one timer
    // per slide would end the evening with three thousand of them.
    return () => window.clearTimeout(timer)
  }, [paused, canAdvance, effectiveIntervalMs, currentId])

  const pause = useCallback(() => setManuallyPaused(true), [])
  const resume = useCallback(() => setManuallyPaused(false), [])

  return {
    current,
    next,
    previous: cursor.previous,
    index,
    generation: cursor.generation,
    paused,
    pause,
    resume,
    advance,
  }
}
