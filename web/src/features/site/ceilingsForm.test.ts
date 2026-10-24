import { describe, expect, it } from 'vitest'
import { noCeilings } from '../../testing/siteFixtures'
import { ceilingsPatch, fieldsFromCeilings, isEmptyPatch } from './ceilingsForm'

/**
 * What the ceilings form turns a client's ceilings into, and what it sends back.
 *
 * It is a unit conversion and a patch, and the tests say so: nothing here knows a bound. Whether
 * `0` or `5000` is acceptable is the server's (`clientCeilings.*Invalid`), so the one judgement
 * made is "is this text a number", and a number out of bounds is **sent**.
 */

const NOW = new Date('2026-07-01T12:00:00.000Z')
const now = () => NOW

const base = fieldsFromCeilings({
  ...noCeilings(),
  maxEvents: 3,
  maxTotalBytes: 5_000_000_000,
  maxEventQuotaBytes: 2_500_000_000,
})

describe('the ceilings form', () => {
  it('reads a ceiling into its box, and no ceiling into an empty one', () => {
    expect(base).toMatchObject({
      maxEvents: '3',
      maxEventsPerPeriod: '',
      maxTotalGigabytes: '5',
      maxEventQuotaGigabytes: '2.5',
      maxRetentionDays: '',
      maxLiveDays: '',
      clipsAllowed: true,
      liveAllowed: true,
      renewPeriod: false,
    })
  })

  it('reads the box’s defaults, which say nothing about opening, as "may open"', () => {
    const fields = fieldsFromCeilings({
      maxEvents: 1,
      maxEventsPerPeriod: 6,
      maxTotalBytes: 5_000_000_000,
      maxEventQuotaBytes: null,
      maxRetentionDays: 30,
      maxLiveDays: 3,
      clipsAllowed: false,
    })

    expect(fields).toMatchObject({ maxEvents: '1', maxEventsPerPeriod: '6', clipsAllowed: false })
    expect(fields.liveAllowed).toBe(true)
  })

  it('sends nothing for a form nobody touched', () => {
    const outcome = ceilingsPatch(base, base, now)

    expect(outcome).toEqual({ ok: true, patch: {} })
  })

  it('sends only the ceilings that changed, so a stored figure is never rewritten by a save', () => {
    // 5 368 709 120 bytes reads "5.36871" in its box. Saving a different ceiling must not turn
    // the stored figure into the rounded one.
    const odd = fieldsFromCeilings({ ...noCeilings(), maxTotalBytes: 5_368_709_120 })

    const outcome = ceilingsPatch({ ...odd, maxEvents: '4' }, odd, now)

    expect(outcome).toEqual({ ok: true, patch: { maxEvents: 4 } })
  })

  it('sends an emptied box as null, which is how a ceiling is removed', () => {
    const outcome = ceilingsPatch({ ...base, maxEvents: '  ' }, base, now)

    expect(outcome).toEqual({ ok: true, patch: { maxEvents: null } })
  })

  it('converts decimal gigabytes to bytes, with a comma as well as a full stop', () => {
    const outcome = ceilingsPatch(
      { ...base, maxTotalGigabytes: '2,5', maxEventQuotaGigabytes: '0.75' },
      base,
      now,
    )

    expect(outcome).toEqual({
      ok: true,
      patch: { maxTotalBytes: 2_500_000_000, maxEventQuotaBytes: 750_000_000 },
    })
  })

  it('names the boxes that are not numbers, and sends nothing at all', () => {
    const outcome = ceilingsPatch(
      { ...base, maxEvents: 'beaucoup', maxLiveDays: '3.5', maxTotalGigabytes: '5 Go' },
      base,
      now,
    )

    expect(outcome).toEqual({
      ok: false,
      invalid: ['maxEvents', 'maxTotalGigabytes', 'maxLiveDays'],
    })
  })

  it('leaves a number out of bounds to the server, which has the catalogue and the sentence', () => {
    const outcome = ceilingsPatch({ ...base, maxEvents: '0', maxRetentionDays: '99999' }, base, now)

    expect(outcome).toEqual({ ok: true, patch: { maxEvents: 0, maxRetentionDays: 99999 } })
  })

  it('refuses a figure that is not a safe integer rather than sending a rounded one', () => {
    const outcome = ceilingsPatch({ ...base, maxEvents: '9'.repeat(20) }, base, now)

    expect(outcome).toEqual({ ok: false, invalid: ['maxEvents'] })
  })

  it('sends a switch only when it moved', () => {
    const outcome = ceilingsPatch({ ...base, clipsAllowed: false }, base, now)

    expect(outcome).toEqual({ ok: true, patch: { clipsAllowed: false } })
  })

  it('renews the period with the instant of now, and with nothing else', () => {
    const outcome = ceilingsPatch({ ...base, renewPeriod: true }, base, now)

    expect(outcome).toEqual({ ok: true, patch: { periodStartedAt: '2026-07-01T12:00:00.000Z' } })
  })

  it('knows an empty patch', () => {
    expect(isEmptyPatch({})).toBe(true)
    expect(isEmptyPatch({ maxEvents: null })).toBe(false)
  })
})
