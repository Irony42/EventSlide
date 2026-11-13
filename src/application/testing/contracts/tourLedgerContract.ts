import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import type { TourLedger } from '../../ports/tourLedger'
import { AT, atPlus } from '../builders'

/**
 * The shared `TourLedger` contract, run against the in-memory fake and the SQLite adapter.
 *
 * The accounts named here must exist before the suite runs: `user_id` is a foreign key in the
 * real table, and the fake mirrors it. Both subjects seed {@link CONTRACT_ACCOUNTS}.
 */

export const CONTRACT_ACCOUNTS = ['user-1', 'user-2'] as const

const USER = asUserId('user-1')
const OTHER = asUserId('user-2')

export const tourLedgerContract = (
  name: string,
  makeSubject: () => Promise<{ ledger: TourLedger; dispose?: () => Promise<void> }>,
): void => {
  describe(`TourLedger contract: ${name}`, () => {
    let ledger: TourLedger
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      ledger = subject.ledger
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    it('knows no tour for an account that was never shown one', async () => {
      expect(await ledger.seenBy(USER)).toEqual([])
    })

    it('remembers a tour once it is marked seen', async () => {
      await ledger.markSeen(USER, 'eventPage', AT)
      expect(await ledger.seenBy(USER)).toEqual(['eventPage'])
    })

    it('keeps one row when the same tour is marked twice', async () => {
      await ledger.markSeen(USER, 'eventPage', AT)
      await ledger.markSeen(USER, 'eventPage', atPlus(60_000))
      expect(await ledger.seenBy(USER)).toEqual(['eventPage'])
    })

    it('answers for one account only', async () => {
      await ledger.markSeen(USER, 'eventPage', AT)
      expect(await ledger.seenBy(OTHER)).toEqual([])
    })

    it('records nothing for an account that does not exist', async () => {
      const ghost = asUserId('nobody')
      await ledger.markSeen(ghost, 'eventPage', AT)
      expect(await ledger.seenBy(ghost)).toEqual([])
    })
  })
}
