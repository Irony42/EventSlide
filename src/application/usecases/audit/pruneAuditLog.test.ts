import { beforeEach, describe, expect, it } from 'vitest'
import { AUDIT_RETENTION_MIN_DAYS } from '../../../domain/audit/auditRetention'
import { asUserId } from '../../../domain/shared/ids'
import { anAuditEntry } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClock } from '../../testing/fakeClock'
import { makePruneAuditLog } from './pruneAuditLog'

const DAY = 24 * 60 * 60 * 1_000

/**
 * Dates a long way from the real calendar on purpose. A pruner that asked the machine what
 * day it is would see a row stamped in 2020 as nine years old and delete it whatever the
 * injected clock said; the injected clock here says the row is a few months old.
 */
const WRITTEN = new Date('2020-01-01T00:00:00.000Z')

describe('pruneAuditLog', () => {
  let audit: FakeAuditLog
  let clock: FakeClock

  beforeEach(() => {
    audit = new FakeAuditLog().withAccounts(asUserId('user-operator'))
    clock = new FakeClock(new Date(WRITTEN.getTime() + 100 * DAY))
  })

  const build = (retentionDays = AUDIT_RETENTION_MIN_DAYS) =>
    makePruneAuditLog({ audit, clock, retentionDays })

  it('removes the entries older than the retention and keeps the rest', async () => {
    await audit.record(anAuditEntry({ at: WRITTEN }))
    await audit.record(anAuditEntry({ at: new Date(WRITTEN.getTime() + 200 * DAY) }))
    clock.set(new Date(WRITTEN.getTime() + 366 * DAY))

    const report = await build(365)()

    expect(report.pruned).toBe(1)
    expect(audit.all().map((row) => row.at.getTime())).toEqual([WRITTEN.getTime() + 200 * DAY])
  })

  it('reports the cutoff it used: the injected clock minus the retention', async () => {
    clock.set(new Date('2021-06-20T21:00:00.000Z'))

    const report = await build(365)()

    expect(report.cutoff.toISOString()).toBe('2020-06-20T21:00:00.000Z')
  })

  it('keeps an entry that is exactly as old as the retention', async () => {
    await audit.record(anAuditEntry({ at: WRITTEN }))
    clock.set(new Date(WRITTEN.getTime() + 365 * DAY))

    expect((await build(365)()).pruned).toBe(0)
  })

  it('measures age on the injected clock, never on the machine’s: a 100-day-old row survives a one-year retention', async () => {
    await audit.record(anAuditEntry({ at: WRITTEN }))

    const report = await build(365)()

    expect(report.pruned).toBe(0)
    expect(audit.all()).toHaveLength(1)
  })

  it('honours a longer retention than the floor', async () => {
    await audit.record(anAuditEntry({ at: WRITTEN }))
    clock.set(new Date(WRITTEN.getTime() + 400 * DAY))

    expect((await build(1095)()).pruned).toBe(0)
    expect((await build(365)()).pruned).toBe(1)
  })

  it('removes nothing from an empty log and says so', async () => {
    expect((await build()()).pruned).toBe(0)
  })

  it('prunes every client’s entries alike', async () => {
    await audit.record(anAuditEntry({ at: WRITTEN, clientId: 'client-1' }))
    await audit.record(anAuditEntry({ at: WRITTEN, clientId: 'client-2' }))
    clock.set(new Date(WRITTEN.getTime() + 400 * DAY))

    expect((await build(365)()).pruned).toBe(2)
  })

  it.each([0, 30, 364, 364.5, Number.NaN, 3651])(
    'refuses to be built with a retention of %s days, because a deleter with the wrong number erases evidence',
    (days) => {
      expect(() => makePruneAuditLog({ audit, clock, retentionDays: days })).toThrow(
        /whole number of days/,
      )
    },
  )

  it('accepts the floor itself', () => {
    expect(() => build(365)).not.toThrow()
  })
})
