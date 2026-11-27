import { describe, expect, it } from 'vitest'
import { rsvpDigestDue, type RsvpDigestInput } from './rsvpDigest'

const at = (iso: string): Date => new Date(iso)

/** Wednesday 09:30 in Paris (winter): a digest could leave. */
const NOW = at('2026-12-09T08:30:00.000Z')

const due = (patch: Partial<RsvpDigestInput> = {}): boolean =>
  rsvpDigestDue({
    subscribed: true,
    familyOn: true,
    lastDigestAt: null,
    seenAt: null,
    lastChangeAt: at('2026-12-08T18:00:00.000Z'),
    now: NOW,
    timeZone: 'Europe/Paris',
    ...patch,
  })

describe('rsvpDigestDue', () => {
  it('is due for a subscribed owner with something new, in the morning', () => {
    expect(due()).toBe(true)
  })

  it('is not due unless the owner subscribed for this event', () => {
    expect(due({ subscribed: false })).toBe(false)
  })

  it('is not due when the account switched the replies family off: the switch beats the tick', () => {
    expect(due({ familyOn: false })).toBe(false)
  })

  it('is not due when no reply ever changed', () => {
    expect(due({ lastChangeAt: null })).toBe(false)
  })

  it('is not due when the owner already looked after the last change, and is when a reply came after', () => {
    expect(due({ seenAt: at('2026-12-08T19:00:00.000Z') })).toBe(false)
    expect(due({ seenAt: at('2026-12-08T18:00:00.000Z') })).toBe(false)
    expect(due({ seenAt: at('2026-12-08T17:59:00.000Z') })).toBe(true)
  })

  it('is not due for a change the last digest already told, and is for one after it', () => {
    expect(due({ lastDigestAt: at('2026-12-08T19:00:00.000Z') })).toBe(false)
    expect(due({ lastDigestAt: at('2026-12-08T07:00:00.000Z') })).toBe(true)
  })

  it('counts from the later of the visit and the last digest', () => {
    expect(
      due({
        seenAt: at('2026-12-08T07:00:00.000Z'),
        lastDigestAt: at('2026-12-08T19:00:00.000Z'),
      }),
    ).toBe(false)
    expect(
      due({
        seenAt: at('2026-12-08T19:00:00.000Z'),
        lastDigestAt: at('2026-12-08T07:00:00.000Z'),
      }),
    ).toBe(false)
  })

  it('waits 20 hours after the last digest, to the minute', () => {
    const change = at('2026-12-09T08:00:00.000Z')
    // 20 h pile before 08:30 UTC is 12:30 UTC the day before.
    expect(due({ lastDigestAt: at('2026-12-08T12:31:00.000Z'), lastChangeAt: change })).toBe(false)
    expect(due({ lastDigestAt: at('2026-12-08T12:30:00.000Z'), lastChangeAt: change })).toBe(true)
  })

  it('leaves from 09:00 local on the dot, not before, in the zone of the invitation', () => {
    expect(due({ now: at('2026-12-09T07:59:00.000Z') })).toBe(false)
    expect(due({ now: at('2026-12-09T08:00:00.000Z') })).toBe(true)
    // 08:30 local is before the digest hour, though the box may write from 08:00.
    expect(due({ now: at('2026-12-09T07:30:00.000Z') })).toBe(false)
    // Summer: Paris is UTC+2, so 07:00 UTC is 09:00 there.
    expect(
      due({ now: at('2026-07-09T06:59:00.000Z'), lastChangeAt: at('2026-07-08T18:00:00Z') }),
    ).toBe(false)
    expect(
      due({ now: at('2026-07-09T07:00:00.000Z'), lastChangeAt: at('2026-07-08T18:00:00Z') }),
    ).toBe(true)
  })

  it('stops at 21:00 local, as every mail of the sweep does', () => {
    expect(due({ now: at('2026-12-09T19:59:00.000Z') })).toBe(true)
    expect(due({ now: at('2026-12-09T20:00:00.000Z') })).toBe(false)
  })
})
