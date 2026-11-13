import { describe, expect, it } from 'vitest'
import { asUserId } from '../../domain/shared/ids'
import { AT, atPlus } from './builders'
import { CONTRACT_ACCOUNTS, tourLedgerContract } from './contracts/tourLedgerContract'
import { FakeTourLedger } from './fakeTourLedger'

tourLedgerContract('fake', async () => ({
  ledger: new FakeTourLedger().withAccounts(...CONTRACT_ACCOUNTS.map(asUserId)),
}))

describe('FakeTourLedger', () => {
  it('keeps the first instant a tour was seen', async () => {
    const user = asUserId('user-1')
    const ledger = new FakeTourLedger().withAccounts(user)
    await ledger.markSeen(user, 'eventPage', AT)
    await ledger.markSeen(user, 'eventPage', atPlus(60_000))
    expect(ledger.seenAt(user, 'eventPage')).toEqual(AT)
  })
})
