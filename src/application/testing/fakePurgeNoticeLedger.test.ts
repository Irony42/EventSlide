import { describe, expect, it } from 'vitest'
import { asEventId } from '../../domain/shared/ids'
import { AT } from './builders'
import { CONTRACT_EVENTS, purgeNoticeLedgerContract } from './contracts/purgeNoticeLedgerContract'
import { FakePurgeNoticeLedger } from './fakePurgeNoticeLedger'

purgeNoticeLedgerContract('fake', async () => ({
  ledger: new FakePurgeNoticeLedger().withEvents(...CONTRACT_EVENTS.map(asEventId)),
}))

describe('FakePurgeNoticeLedger', () => {
  it('says when a level was noted, and lists the notes in the order they were made', async () => {
    const event = asEventId('event-1')
    const ledger = new FakePurgeNoticeLedger().withEvents(event)
    await ledger.note(event, 14, AT)
    await ledger.note(event, 3, AT)
    expect(ledger.notedAt(event)).toEqual(AT)
    expect(ledger.noted.map((note) => note.level)).toEqual([14, 3])
  })
})
