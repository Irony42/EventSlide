import { describe, expect, it } from 'vitest'
import { ClientCeilings } from './clientCeilings'
import { startingCeilings, type NewClientDefaults } from './newClientCeilings'

const NOW = new Date('2026-10-23T09:30:00.000Z')
const EARLIER = new Date('2026-01-01T00:00:00.000Z')

/** What a box that configured nothing hands the domain: no ceiling, clips allowed. */
const NONE: NewClientDefaults = {
  maxEvents: null,
  maxEventsPerPeriod: null,
  maxTotalBytes: null,
  maxEventQuotaBytes: null,
  maxRetentionDays: null,
  maxLiveDays: null,
  clipsAllowed: true,
}

/** A box with a tier: every ceiling set, clips off. */
const TIER: NewClientDefaults = {
  maxEvents: 1,
  maxEventsPerPeriod: 6,
  maxTotalBytes: 20_000_000_000,
  maxEventQuotaBytes: 5_000_000_000,
  maxRetentionDays: 30,
  maxLiveDays: 3,
  clipsAllowed: false,
}

/** What the use case would store: the ceilings, after the domain has had its say. */
const stored = (defaults: NewClientDefaults, given?: Parameters<typeof startingCeilings>[1]) => {
  const created = ClientCeilings.create(startingCeilings(defaults, given, NOW))
  if (!created.ok) throw new Error(`the ceilings were refused: ${created.error.code}`)
  return created.value.toProps()
}

describe('startingCeilings', () => {
  describe('on a box that configured nothing', () => {
    it('is exactly the unlimited client, with no ceiling named and none given', () => {
      expect(stored(NONE)).toEqual(ClientCeilings.unlimited().toProps())
      expect(stored(NONE, {})).toEqual(ClientCeilings.unlimited().toProps())
    })

    it('leaves the period undated, because there is no count for it to date', () => {
      expect(startingCeilings(NONE, undefined, NOW)).not.toHaveProperty('periodStartedAt')
    })

    it('keeps the ceilings an operator names, as it always did', () => {
      expect(stored(NONE, { maxEvents: 3, clipsAllowed: false })).toEqual({
        ...ClientCeilings.unlimited().toProps(),
        maxEvents: 3,
        clipsAllowed: false,
      })
    })
  })

  describe('on a box with defaults', () => {
    it('gives a client with nothing named every default', () => {
      expect(stored(TIER)).toMatchObject(TIER)
      expect(stored(TIER, {})).toMatchObject(TIER)
    })

    it('keeps every ceiling the operator named, and fills in the rest', () => {
      const props = stored(TIER, { maxEvents: 10, maxLiveDays: 14 })

      expect(props).toMatchObject({ ...TIER, maxEvents: 10, maxLiveDays: 14 })
    })

    it.each([
      ['maxEvents', 7],
      ['maxEventsPerPeriod', 7],
      ['maxTotalBytes', 7_000_000_000],
      ['maxEventQuotaBytes', 7_000_000_000],
      ['maxRetentionDays', 60],
      ['maxLiveDays', 7],
      ['clipsAllowed', true],
    ] as const)('lets a named %s win over its default', (key, value) => {
      expect(stored(TIER, { [key]: value })[key]).toBe(value)
    })

    it.each([
      'maxEvents',
      'maxEventsPerPeriod',
      'maxTotalBytes',
      'maxEventQuotaBytes',
      'maxRetentionDays',
      'maxLiveDays',
    ] as const)('lets an explicit null lift the default %s for this client alone', (key) => {
      const props = stored(TIER, { [key]: null })

      expect(props[key]).toBeNull()
      // Nothing else moved: the other defaults are still the box's.
      for (const other of Object.keys(TIER) as (keyof NewClientDefaults)[]) {
        if (other !== key) expect(props[other], other).toBe(TIER[other])
      }
    })

    it('reads an explicit undefined as an omission, not as a ceiling of nothing', () => {
      const props = stored(TIER, { maxEvents: undefined } as never)

      expect(props.maxEvents).toBe(1)
    })

    it('passes the quarantine switch through: it has no default of its own', () => {
      expect(stored(TIER).liveAllowed).toBe(true)
      expect(stored(TIER, { liveAllowed: false }).liveAllowed).toBe(false)
    })
  })

  describe('the period a count starts', () => {
    it('starts at the moment of provisioning when the count comes from the defaults', () => {
      expect(stored(TIER).periodStartedAt).toEqual(NOW)
    })

    it('is a copy of that moment, so the caller moving its Date moves nothing stored', () => {
      const now = new Date(NOW.getTime())
      const input = startingCeilings(TIER, undefined, now)

      expect(input.periodStartedAt).not.toBe(now)
      now.setUTCFullYear(2030)
      expect(input.periodStartedAt).toEqual(NOW)
    })

    it('starts at the moment of provisioning when the operator names the count too, as a console form pre-filled from the defaults does', () => {
      expect(stored(TIER, { maxEventsPerPeriod: 6 }).periodStartedAt).toEqual(NOW)
      expect(stored(NONE, { maxEventsPerPeriod: 2 }).periodStartedAt).toEqual(NOW)
    })

    it('is left alone when the operator lifts the count: there is nothing to date', () => {
      expect(stored(TIER, { maxEventsPerPeriod: null }).periodStartedAt).toBeNull()
    })

    it('is the operator’s when they give one, beside a count from the defaults', () => {
      expect(stored(TIER, { periodStartedAt: EARLIER }).periodStartedAt).toEqual(EARLIER)
    })

    it('is the operator’s when they give one with a count of their own', () => {
      const props = stored(TIER, { maxEventsPerPeriod: 2, periodStartedAt: EARLIER })

      expect(props.maxEventsPerPeriod).toBe(2)
      expect(props.periodStartedAt).toEqual(EARLIER)
    })

    it('is not stamped when the box has no count, whatever else it sets', () => {
      expect(stored({ ...TIER, maxEventsPerPeriod: null }).periodStartedAt).toBeNull()
    })
  })
})
