import { describe, expect, it } from 'vitest'
import {
  CEILING_WARNING_PERCENT,
  ceilingLevel,
  ceilingMeters,
  type CeilingUsage,
} from './ceilingUsage'
import { ClientCeilings } from './clientCeilings'

/**
 * The 90 per cent line (G2-16 / P3-17: "le bandeau passe les seuils à 89, 90 et 100 %"). Each
 * case below sits on one side of a boundary, so moving the line by a single per cent, or
 * turning `>=` into `>`, turns one of them red.
 */
describe('ceilingLevel', () => {
  it('names the warning line the plan names', () => {
    expect(CEILING_WARNING_PERCENT).toBe(90)
  })

  it.each([
    [0, 100, 'ok'],
    [89, 100, 'ok'],
    [90, 100, 'warning'],
    [99, 100, 'warning'],
    [100, 100, 'reached'],
    [101, 100, 'reached'],
  ] as const)('puts %i of %i at %s', (used, max, level) => {
    expect(ceilingLevel(used, max)).toBe(level)
  })

  it('puts the line at exactly ninety per cent of a ceiling that is not a multiple of ten', () => {
    // 9 of 10 and 27 of 30 are exactly ninety per cent; 26 of 30 is below it.
    expect(ceilingLevel(9, 10)).toBe('warning')
    expect(ceilingLevel(27, 30)).toBe('warning')
    expect(ceilingLevel(26, 30)).toBe('ok')
    // One event of a ceiling of one is the ceiling, not a warning.
    expect(ceilingLevel(0, 1)).toBe('ok')
    expect(ceilingLevel(1, 1)).toBe('reached')
  })

  it('stays exact for a byte ceiling in the gigabytes', () => {
    const max = 5_000_000_000
    expect(ceilingLevel(4_499_999_999, max)).toBe('ok')
    expect(ceilingLevel(4_500_000_000, max)).toBe('warning')
    expect(ceilingLevel(max, max)).toBe('reached')
  })

  it('reads a ceiling that is not a positive number as already reached, never as room', () => {
    expect(ceilingLevel(0, 0)).toBe('reached')
    expect(ceilingLevel(0, -1)).toBe('reached')
    expect(ceilingLevel(0, Number.NaN)).toBe('reached')
  })
})

describe('ceilingMeters', () => {
  const usage: CeilingUsage = { events: 2, eventsCreatedInPeriod: 5, usedBytes: 90 }

  it('has no meter for a ceiling that is not set', () => {
    expect(ceilingMeters(ClientCeilings.unlimited(), usage)).toEqual([])
  })

  it('has one meter per bounded ceiling, each against its own count', () => {
    const ceilings = ClientCeilings.restore({
      ...ClientCeilings.unlimited().toProps(),
      maxEvents: 2,
      maxEventsPerPeriod: 6,
      maxTotalBytes: 100,
    })

    expect(ceilingMeters(ceilings, usage)).toEqual([
      { kind: 'events', used: 2, max: 2, level: 'reached' },
      { kind: 'eventsPerPeriod', used: 5, max: 6, level: 'ok' },
      { kind: 'storage', used: 90, max: 100, level: 'warning' },
    ])
  })

  it('does not turn the other ceilings of a client into meters', () => {
    const ceilings = ClientCeilings.restore({
      ...ClientCeilings.unlimited().toProps(),
      maxRetentionDays: 30,
      maxLiveDays: 3,
      maxEventQuotaBytes: 10,
      clipsAllowed: false,
      liveAllowed: false,
    })

    expect(ceilingMeters(ceilings, usage)).toEqual([])
  })
})
