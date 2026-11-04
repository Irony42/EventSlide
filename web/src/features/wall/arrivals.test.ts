import { describe, expect, it } from 'vitest'
import {
  INITIAL_SIGNAL,
  NO_ARRIVALS,
  RESUME_GAP_MS,
  TOAST_MIN_GAP_MS,
  TOAST_VISIBLE_MS,
  detectArrivals,
  nextWakeMs,
  reduceSignal,
  type SnapshotItem,
  type WallSnapshot,
} from './arrivals'

const photo = (id: string): SnapshotItem => ({ id, kind: 'photo' })
const clip = (id: string): SnapshotItem => ({ id, kind: 'clip' })
const snap = (items: SnapshotItem[], total: number | null, at = 0): WallSnapshot => ({
  items,
  total,
  at,
})

describe('detectArrivals', () => {
  it('is silent on the first read, however many photos are already there', () => {
    expect(detectArrivals(null, snap([photo('a'), photo('b')], 2))).toEqual(NO_ARRIVALS)
  })

  it('announces a photo that became visible, whenever it was sent', () => {
    const before = snap([photo('a')], 1, 0)
    const after = snap([photo('b'), photo('a')], 2, 5_000)

    expect(detectArrivals(before, after)).toEqual({ photos: 1, clips: 0 })
  })

  it('tells a clip from a photograph, and counts a mix', () => {
    const before = snap([], 0, 0)
    const after = snap([clip('c'), photo('p'), photo('q')], 3, 1_000)

    expect(detectArrivals(before, after)).toEqual({ photos: 2, clips: 1 })
  })

  it('is silent after a gap longer than two minutes: a resumption, not a burst', () => {
    const before = snap([photo('a')], 1, 0)

    expect(detectArrivals(before, snap([photo('b'), photo('a')], 2, RESUME_GAP_MS + 1))).toEqual(
      NO_ARRIVALS,
    )
    // Exactly at the limit, it is still an ordinary burst.
    expect(detectArrivals(before, snap([photo('b'), photo('a')], 2, RESUME_GAP_MS))).toEqual({
      photos: 1,
      clips: 0,
    })
  })

  it('does not announce a photo that only came back into the window after a deletion', () => {
    // 200 in the window, the 201st is pushed in when one is deleted: the total went down.
    const before = snap([photo('a'), photo('b')], 201, 0)
    const after = snap([photo('a'), photo('old')], 200, 1_000)

    expect(detectArrivals(before, after)).toEqual(NO_ARRIVALS)
  })

  it('never announces more than the total grew by', () => {
    const before = snap([photo('a')], 10, 0)
    const after = snap([photo('x'), photo('y'), photo('z'), photo('a')], 11, 1_000)

    expect(detectArrivals(before, after)).toEqual({ photos: 1, clips: 0 })
  })

  it('announces nothing without a total on both sides, so turning the switch on is silent', () => {
    expect(detectArrivals(snap([], null, 0), snap([photo('a')], 1, 1_000))).toEqual(NO_ARRIVALS)
    expect(detectArrivals(snap([], 0, 0), snap([photo('a')], null, 1_000))).toEqual(NO_ARRIVALS)
  })
})

const one = { photos: 1, clips: 0 }

describe('reduceSignal', () => {
  it('starts the first signal at once, for four seconds', () => {
    const state = reduceSignal(INITIAL_SIGNAL, { type: 'arrive', arrivals: one }, 1_000)

    expect(state.visible).toEqual({ photos: 1, clips: 0, until: 1_000 + TOAST_VISIBLE_MS })
    expect(state.reserve).toEqual(NO_ARRIVALS)
  })

  it('sets later arrivals aside and announces them together, once the interval has passed', () => {
    let state = reduceSignal(INITIAL_SIGNAL, { type: 'arrive', arrivals: one }, 0)
    state = reduceSignal(state, { type: 'arrive', arrivals: one }, 2_000)
    state = reduceSignal(state, { type: 'arrive', arrivals: { photos: 0, clips: 1 } }, 3_000)

    expect(state.visible?.photos).toBe(1)
    expect(state.reserve).toEqual({ photos: 1, clips: 1 })

    // Hidden at 4 s, but the next start waits for 10 s since the last one.
    state = reduceSignal(state, { type: 'tick' }, TOAST_VISIBLE_MS)
    expect(state.visible).toBeNull()
    expect(state.reserve).toEqual({ photos: 1, clips: 1 })

    state = reduceSignal(state, { type: 'tick' }, TOAST_MIN_GAP_MS)
    expect(state.visible).toEqual({
      photos: 1,
      clips: 1,
      until: TOAST_MIN_GAP_MS + TOAST_VISIBLE_MS,
    })
    expect(state.reserve).toEqual(NO_ARRIVALS)
  })

  it('does nothing when the reserve is empty, and never shows two bubbles', () => {
    expect(reduceSignal(INITIAL_SIGNAL, { type: 'tick' }, 50_000)).toEqual(INITIAL_SIGNAL)
    expect(
      reduceSignal(INITIAL_SIGNAL, { type: 'arrive', arrivals: NO_ARRIVALS }, 1_000).visible,
    ).toBeNull()

    const shown = reduceSignal(INITIAL_SIGNAL, { type: 'arrive', arrivals: one }, 0)
    const again = reduceSignal(shown, { type: 'arrive', arrivals: one }, 1_000)
    expect(again.visible).toBe(shown.visible)
  })

  it('forgets everything when the switch is turned off', () => {
    const shown = reduceSignal(INITIAL_SIGNAL, { type: 'arrive', arrivals: one }, 0)

    expect(reduceSignal(shown, { type: 'reset' }, 1_000)).toEqual(INITIAL_SIGNAL)
  })

  it('holds a signal that arrives with the challenge banner, and drops nothing', () => {
    let state = reduceSignal(INITIAL_SIGNAL, { type: 'hold', held: true }, 0)
    state = reduceSignal(state, { type: 'arrive', arrivals: one }, 1_000)

    expect(state.visible).toBeNull()
    expect(state.reserve).toEqual(one)
    expect(nextWakeMs(state, 1_000)).toBeNull()

    state = reduceSignal(state, { type: 'hold', held: false }, 5_000)

    expect(state.visible).toEqual({ photos: 1, clips: 0, until: 5_000 + TOAST_VISIBLE_MS })
    expect(state.reserve).toEqual(NO_ARRIVALS)
  })

  it('takes a bubble already on screen back into the reserve when the banner goes up', () => {
    let state = reduceSignal(INITIAL_SIGNAL, { type: 'arrive', arrivals: one }, 0)

    state = reduceSignal(state, { type: 'hold', held: true }, 1_000)

    expect(state.visible).toBeNull()
    expect(state.reserve).toEqual(one)
  })

  it('announces what was held together with what arrived meanwhile, once released', () => {
    let state = reduceSignal(INITIAL_SIGNAL, { type: 'hold', held: true }, 0)
    state = reduceSignal(state, { type: 'arrive', arrivals: one }, 1_000)
    state = reduceSignal(state, { type: 'arrive', arrivals: { photos: 0, clips: 1 } }, 2_000)

    state = reduceSignal(state, { type: 'hold', held: false }, 3_000)

    expect(state.visible).toMatchObject({ photos: 1, clips: 1 })
  })
})

describe('nextWakeMs', () => {
  it('is never when there is nothing to hide and nothing waiting', () => {
    expect(nextWakeMs(INITIAL_SIGNAL, 0)).toBeNull()
  })

  it('wakes at the end of the bubble, then at the end of the interval for what waits', () => {
    const shown = reduceSignal(INITIAL_SIGNAL, { type: 'arrive', arrivals: one }, 0)
    expect(nextWakeMs(shown, 1_000)).toBe(TOAST_VISIBLE_MS - 1_000)

    const waiting = reduceSignal(shown, { type: 'arrive', arrivals: one }, 1_000)
    expect(nextWakeMs(waiting, 1_000)).toBe(TOAST_VISIBLE_MS - 1_000)

    const hidden = reduceSignal(waiting, { type: 'tick' }, TOAST_VISIBLE_MS)
    expect(nextWakeMs(hidden, TOAST_VISIBLE_MS)).toBe(TOAST_MIN_GAP_MS - TOAST_VISIBLE_MS)
  })

  it('is zero for a reserve that may start now', () => {
    const state = { ...INITIAL_SIGNAL, reserve: one }

    expect(nextWakeMs(state, 0)).toBe(0)
  })
})
