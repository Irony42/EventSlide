import { describe, expect, it } from 'vitest'
import { asEventId } from '../../domain/shared/ids'
import { AT } from './builders'
import {
  eventMailNoticeLedgerContract,
  NOTICE_CONTRACT_EVENTS,
} from './contracts/eventMailNoticeLedgerContract'
import { FakeEventMailNoticeLedger } from './fakeEventMailNoticeLedger'

eventMailNoticeLedgerContract('fake', async () => ({
  ledger: new FakeEventMailNoticeLedger().withEvents(...NOTICE_CONTRACT_EVENTS.map(asEventId)),
}))

describe('FakeEventMailNoticeLedger', () => {
  it('says when a notice was noted, and lists the notes in the order they were made', async () => {
    const event = asEventId('event-1')
    const ledger = new FakeEventMailNoticeLedger().withEvents(event)

    await ledger.note(event, 'rsvpErasure', '7@d', AT)
    await ledger.note(event, 'rsvpErasure', '1@d', AT)
    await ledger.note(event, 'rsvpErasure', '1@d', AT)

    expect(ledger.notedAt(event, 'rsvpErasure', '7@d')).toEqual(AT)
    expect(ledger.notedAt(event, 'rsvpErasure', 'none')).toBeUndefined()
    expect(ledger.noted.map((note) => note.key)).toEqual(['7@d', '1@d'])
  })
})
