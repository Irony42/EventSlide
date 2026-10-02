import { describe, expect, it } from 'vitest'
import { anAuditEntry, atPlus } from './builders'
import { auditLogContract } from './contracts/auditLogContract'
import { FakeAuditLog } from './fakeAuditLog'

auditLogContract('fake', async () => ({ log: new FakeAuditLog() }))

describe('FakeAuditLog', () => {
  it('hands back every row oldest first for a test that wants the whole log', async () => {
    const log = new FakeAuditLog()
    await log.record(anAuditEntry({ at: atPlus(2_000) }))
    await log.record(anAuditEntry({ at: atPlus(1_000) }))

    expect(log.all().map((row) => row.seq)).toEqual([1, 2])
  })

  it('does not let a caller edit the log through the array it was handed', async () => {
    const log = new FakeAuditLog()
    await log.record(anAuditEntry())

    ;(log.all() as unknown[]).length = 0

    expect(log.all()).toHaveLength(1)
  })
})
