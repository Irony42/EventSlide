import { describe, expect, it } from 'vitest'
import { anEventDto, eventSettings } from '../../testing/renderWithProviders'
import { countdownParts, revealBandOf } from './revealBand'
import type { EventDto } from '../../lib/api/dto'

const NOW = 1_000_000_000_000
const MINUTE = 60_000

const held = (atMs: number | null, overrides: Partial<EventDto> = {}): EventDto =>
  anEventDto({
    settings: eventSettings({
      reveal: {
        enabled: true,
        at: atMs === null ? null : new Date(atMs).toISOString(),
        film: false,
      },
    }),
    reveal: {
      enabled: true,
      revealed: false,
      atMs,
      serverNowMs: NOW,
      film: false,
      readyCount: 7,
    },
    ...overrides,
  })

const closing = (ms: number): string => new Date(NOW + ms).toISOString()

describe('countdownParts', () => {
  it('says "soon" under a minute and a time from a minute on', () => {
    expect(countdownParts(59_999)).toBe('soon')
    expect(countdownParts(MINUTE)).toEqual({ hours: 0, minutes: 1 })
  })

  it('rounds a started minute up, so zero is never said with time left', () => {
    expect(countdownParts(MINUTE + 1)).toEqual({ hours: 0, minutes: 2 })
  })

  it('splits hours and minutes', () => {
    expect(countdownParts(130 * MINUTE)).toEqual({ hours: 2, minutes: 10 })
    expect(countdownParts(60 * MINUTE)).toEqual({ hours: 1, minutes: 0 })
  })
})

describe('revealBandOf', () => {
  it('has no band with the mode off or unknown', () => {
    const off = anEventDto({
      reveal: {
        enabled: false,
        revealed: true,
        atMs: null,
        serverNowMs: NOW,
        film: false,
        readyCount: null,
      },
    })

    expect(revealBandOf(anEventDto(), NOW)).toBeNull()
    expect(revealBandOf(off, NOW)).toBeNull()
  })

  it('waits for an hour that is ahead of the server’s clock', () => {
    expect(revealBandOf(held(NOW + 5 * MINUTE), NOW)).toMatchObject({
      kind: 'waiting',
      leftMs: 5 * MINUTE,
      readyCount: 7,
    })
  })

  it('is revealed at the exact instant: the hour is included', () => {
    expect(revealBandOf(held(NOW), NOW)).toMatchObject({ kind: 'revealed', atMs: NOW })
  })

  it('believes the server when it says revealed, whatever the clock', () => {
    const event = held(NOW + 5 * MINUTE)
    const said: EventDto = {
      ...event,
      reveal: {
        enabled: true,
        revealed: true,
        atMs: NOW,
        serverNowMs: NOW,
        film: false,
        readyCount: null,
      },
    }

    expect(revealBandOf(said, NOW - MINUTE)?.kind).toBe('revealed')
  })

  it('waits at the button for ever: no hour, no countdown', () => {
    expect(revealBandOf(held(null), NOW + 1e12)).toMatchObject({ kind: 'waiting', leftMs: null })
  })

  it('counts the photographs waiting for a decision from the event, not the gate', () => {
    expect(revealBandOf(held(NOW + MINUTE, { pendingCount: 14 }), NOW)).toMatchObject({
      pendingCount: 14,
    })
  })

  it('flags an ended evening that was never revealed, closed or archived', () => {
    expect(revealBandOf(held(null, { status: 'closed' }), NOW)).toMatchObject({ closedHeld: true })
    expect(revealBandOf(held(null, { status: 'archived' }), NOW)).toMatchObject({
      closedHeld: true,
    })
    expect(revealBandOf(held(null, { status: 'live' }), NOW)).toMatchObject({ closedHeld: false })
  })

  it('flags a scheduled end before the hour, or with no hour, and not after it', () => {
    const before = held(NOW + 3 * MINUTE, { scheduledCloseAt: closing(MINUTE) })
    const noHour = held(null, { scheduledCloseAt: closing(MINUTE) })
    const after = held(NOW + MINUTE, { scheduledCloseAt: closing(3 * MINUTE) })
    const none = held(null, { scheduledCloseAt: null })

    expect(revealBandOf(before, NOW)).toMatchObject({ closesBefore: true })
    expect(revealBandOf(noHour, NOW)).toMatchObject({ closesBefore: true })
    expect(revealBandOf(after, NOW)).toMatchObject({ closesBefore: false })
    expect(revealBandOf(none, NOW)).toMatchObject({ closesBefore: false })
  })

  it('does not warn of a coming end once the evening has already ended', () => {
    const ended = held(null, { status: 'closed', scheduledCloseAt: closing(-MINUTE) })

    expect(revealBandOf(ended, NOW)).toMatchObject({ closedHeld: true, closesBefore: false })
  })
})
