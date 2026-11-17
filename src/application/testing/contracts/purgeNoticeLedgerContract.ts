import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asEventId } from '../../../domain/shared/ids'
import type { PurgeNoticeLedger } from '../../ports/purgeNoticeLedger'
import { AT, atPlus } from '../builders'

/**
 * The shared `PurgeNoticeLedger` contract, run against the in-memory fake and the SQLite adapter.
 * The events named here must exist before the suite runs: `event_id` is a foreign key in the
 * real table, and the fake mirrors it. Both subjects seed {@link CONTRACT_EVENTS}.
 */

export const CONTRACT_EVENTS = ['event-1', 'event-2'] as const

const EVENT = asEventId('event-1')
const OTHER = asEventId('event-2')

export const purgeNoticeLedgerContract = (
  name: string,
  makeSubject: () => Promise<{ ledger: PurgeNoticeLedger; dispose?: () => Promise<void> }>,
): void => {
  describe(`PurgeNoticeLedger contract: ${name}`, () => {
    let ledger: PurgeNoticeLedger
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      ledger = subject.ledger
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    it('has noted nothing for an event that was never written about', async () => {
      expect(await ledger.lastLevel(EVENT)).toBeNull()
    })

    it('remembers the level once it is noted', async () => {
      await ledger.note(EVENT, 14, AT)
      expect(await ledger.lastLevel(EVENT)).toBe(14)
    })

    it('replaces the level when a more urgent one is noted, keeping one row', async () => {
      await ledger.note(EVENT, 14, AT)
      await ledger.note(EVENT, 3, atPlus(60_000))
      expect(await ledger.lastLevel(EVENT)).toBe(3)
    })

    it('answers for one event only', async () => {
      await ledger.note(EVENT, 1, AT)
      expect(await ledger.lastLevel(OTHER)).toBeNull()
    })

    it('notes nothing for an event that does not exist', async () => {
      const ghost = asEventId('nobody')
      await ledger.note(ghost, 3, AT)
      expect(await ledger.lastLevel(ghost)).toBeNull()
    })
  })
}
