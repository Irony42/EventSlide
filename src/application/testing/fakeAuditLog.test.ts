import { describe, expect, it } from 'vitest'
import { asUserId } from '../../domain/shared/ids'
import { anAuditEntry, atPlus } from './builders'
import { AUDIT_CONTRACT_FIXTURES, auditLogContract } from './contracts/auditLogContract'
import { FakeAuditLog } from './fakeAuditLog'

auditLogContract('fake', async () => ({
  log: new FakeAuditLog().withAccounts(...AUDIT_CONTRACT_FIXTURES.userIds.map(asUserId)),
}))

describe('FakeAuditLog', () => {
  it('hands back every row oldest first for a test that wants the whole log', async () => {
    const log = new FakeAuditLog().withAccounts(asUserId('user-operator'))
    await log.record(anAuditEntry({ at: atPlus(2_000) }))
    await log.record(anAuditEntry({ at: atPlus(1_000) }))

    expect(log.all().map((row) => row.seq)).toEqual([1, 2])
  })

  it('does not let a caller edit the log through the array it was handed', async () => {
    const log = new FakeAuditLog().withAccounts(asUserId('user-operator'))
    await log.record(anAuditEntry())

    ;(log.all() as unknown[]).length = 0

    expect(log.all()).toHaveLength(1)
  })
})

describe('FakeAuditLog accounts', () => {
  it('returns itself from withAccounts, so a test arranges its world in one expression', () => {
    const log = new FakeAuditLog()

    expect(log.withAccounts(asUserId('user-operator'))).toBe(log)
  })

  it('accepts a system entry with no account without being told about any', async () => {
    const log = new FakeAuditLog()

    await log.record(anAuditEntry({ actor: { kind: 'system', label: 'retention-sweeper' } }))

    expect(log.all()).toHaveLength(1)
  })
})
