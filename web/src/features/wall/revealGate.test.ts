import { describe, expect, it } from 'vitest'
import type { WallRevealDto } from '../../lib/api/dto'
import { aWallResponse } from '../../testing/renderWithProviders'
import {
  REVEAL_JITTER_MAX_MS,
  awaitsReveal,
  jitterMs,
  revealDelayMs,
  silencedBeforeReveal,
} from './revealGate'

const SERVER_NOW = 1_800_000_000_000

const reveal = (overrides: Partial<WallRevealDto> = {}): WallRevealDto => ({
  enabled: true,
  revealed: false,
  atMs: SERVER_NOW + 60_000,
  serverNowMs: SERVER_NOW,
  film: false,
  readyCount: 12,
  ...overrides,
})

describe('awaitsReveal', () => {
  it('is true only while the mode is on and the server has not revealed the evening', () => {
    expect(awaitsReveal(reveal())).toBe(true)
    expect(awaitsReveal(reveal({ revealed: true }))).toBe(false)
    expect(awaitsReveal(reveal({ enabled: false, revealed: true }))).toBe(false)
    // The mode off decides by itself: a block that said otherwise would not hold a wall back.
    expect(awaitsReveal(reveal({ enabled: false, revealed: false }))).toBe(false)
    expect(awaitsReveal(undefined)).toBe(false)
  })
})

describe('revealDelayMs', () => {
  it('is the hour minus the server’s clock at the read, whatever this machine’s clock says', () => {
    // No `Date.now()` anywhere in this: a projector five minutes off waits exactly as long as one
    // that is right, because the delay is read off the answer alone.
    expect(revealDelayMs(reveal())).toBe(60_000)
    expect(revealDelayMs(reveal({ atMs: SERVER_NOW + 5 * 60_000 }))).toBe(300_000)
  })

  it('never waits a negative time, and waits for nothing without an hour or without the mode', () => {
    expect(revealDelayMs(reveal({ atMs: SERVER_NOW - 1_000 }))).toBe(0)
    expect(revealDelayMs(reveal({ atMs: null }))).toBeNull()
    expect(revealDelayMs(reveal({ revealed: true }))).toBeNull()
    expect(revealDelayMs(undefined)).toBeNull()
  })
})

describe('jitterMs', () => {
  it('spreads the read over 0 to 3 seconds, ends included on the low side only', () => {
    expect(REVEAL_JITTER_MAX_MS).toBe(3_000)
    expect(jitterMs(0)).toBe(0)
    expect(jitterMs(0.5)).toBe(1_500)
    expect(jitterMs(0.999999)).toBeLessThan(REVEAL_JITTER_MAX_MS)
    expect(jitterMs(1)).toBeLessThan(REVEAL_JITTER_MAX_MS)
    expect(jitterMs(-1)).toBe(0)
  })
})

describe('silencedBeforeReveal', () => {
  it('takes the souvenir total out of a read taken before the reveal', () => {
    const read = aWallResponse({ souvenirCount: 412, reveal: reveal() })

    expect(silencedBeforeReveal(read).souvenirCount).toBeNull()
  })

  it('leaves a revealed evening and an ordinary one exactly as the server sent them', () => {
    const revealed = aWallResponse({ souvenirCount: 412, reveal: reveal({ revealed: true }) })
    const ordinary = aWallResponse({ souvenirCount: 412 })

    expect(silencedBeforeReveal(revealed)).toBe(revealed)
    expect(silencedBeforeReveal(ordinary)).toBe(ordinary)
  })
})
