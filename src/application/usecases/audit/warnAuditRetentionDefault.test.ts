import { beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { AT, anAuditEntry } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClock } from '../../testing/fakeClock'
import { makeWarnAuditRetentionDefault } from './warnAuditRetentionDefault'

const DAY = 24 * 60 * 60 * 1_000

describe('warnAuditRetentionDefault', () => {
  let audit: FakeAuditLog
  let logger: CapturingLogger
  let clock: FakeClock

  beforeEach(() => {
    audit = new FakeAuditLog().withAccounts(asUserId('user-operator'))
    logger = new CapturingLogger()
    clock = new FakeClock(AT)
  })

  const warn = (fromDefault: boolean, retentionDays = 365) =>
    makeWarnAuditRetentionDefault({ audit, clock, logger, retentionDays, fromDefault })()

  const oldRow = async (days: number) =>
    audit.record(anAuditEntry({ at: new Date(AT.getTime() - days * DAY) }))

  it('warns once, naming the variable, when the default is in force and a row is older than it', async () => {
    await oldRow(400)

    expect(await warn(true)).toBe(true)

    const warnings = logger.lines.filter((entry) => entry.level === 'warn')
    expect(warnings).toHaveLength(1)
    expect(JSON.stringify(warnings[0])).toContain('AUDIT_RETENTION_DAYS')
  })

  it('says nothing when the operator set the variable: it is their decision', async () => {
    await oldRow(400)

    expect(await warn(false)).toBe(false)
    expect(logger.lines).toEqual([])
  })

  it('says nothing when no row is older than the retention', async () => {
    await oldRow(100)

    expect(await warn(true)).toBe(false)
    expect(logger.lines).toEqual([])
  })

  it('says nothing for an empty log', async () => {
    expect(await warn(true)).toBe(false)
  })

  it('does not warn about a row exactly as old as the retention: the sweep keeps it', async () => {
    await oldRow(365)

    expect(await warn(true)).toBe(false)
  })
})
