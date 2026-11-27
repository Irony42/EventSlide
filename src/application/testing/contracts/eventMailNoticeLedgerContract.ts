import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NoticeKind } from '../../../domain/notices/noticeKind'
import { asEventId } from '../../../domain/shared/ids'
import type { EventMailNoticeLedger } from '../../ports/eventMailNoticeLedger'
import { AT, atPlus } from '../builders'

/**
 * The shared `EventMailNoticeLedger` contract, run against the in-memory fake and the SQLite adapter. The
 * events named here must exist before the suite runs: `event_id` is a foreign key in the real table, and
 * the fake mirrors it. Both subjects seed {@link NOTICE_CONTRACT_EVENTS}.
 */

export const NOTICE_CONTRACT_EVENTS = ['event-1', 'event-2'] as const

const EVENT = asEventId('event-1')
const OTHER = asEventId('event-2')

export const eventMailNoticeLedgerContract = (
  name: string,
  makeSubject: () => Promise<{ ledger: EventMailNoticeLedger; dispose?: () => Promise<void> }>,
): void => {
  describe(`EventMailNoticeLedger contract: ${name}`, () => {
    let ledger: EventMailNoticeLedger
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      ledger = subject.ledger
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    it('has noted nothing for a notice that was never served', async () => {
      expect(await ledger.has(EVENT, 'rsvpFull', 'full@120')).toBe(false)
    })

    it('answers true to the call that notes a notice, and remembers it', async () => {
      expect(await ledger.note(EVENT, 'rsvpFull', 'full@120', AT)).toBe(true)
      expect(await ledger.has(EVENT, 'rsvpFull', 'full@120')).toBe(true)
    })

    it('answers true to one call only when a notice is noted twice: the one that sends', async () => {
      const first = await ledger.note(EVENT, 'rsvpErasure', '7@2027-01-12', AT)
      const second = await ledger.note(EVENT, 'rsvpErasure', '7@2027-01-12', atPlus(60_000))

      expect([first, second]).toEqual([true, false])
    })

    it('answers true to one call only when two race for the same notice', async () => {
      const results = await Promise.all([
        ledger.note(EVENT, 'eventClosed', 'first', AT),
        ledger.note(EVENT, 'eventClosed', 'first', AT),
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
    })

    it('tells two notices of one event apart by their key and by their kind', async () => {
      await ledger.note(EVENT, 'rsvpFull', 'full@120', AT)

      expect(await ledger.has(EVENT, 'rsvpFull', 'full@150')).toBe(false)
      expect(await ledger.has(EVENT, 'rsvpDeadline', 'full@120')).toBe(false)
      expect(await ledger.note(EVENT, 'rsvpFull', 'full@150', AT)).toBe(true)
    })

    it('answers for one event only', async () => {
      await ledger.note(EVENT, 'windowEnding', '2026-12-13T10:00:00.000Z', AT)

      expect(await ledger.has(OTHER, 'windowEnding', '2026-12-13T10:00:00.000Z')).toBe(false)
      expect(await ledger.note(OTHER, 'windowEnding', '2026-12-13T10:00:00.000Z', AT)).toBe(true)
    })

    it('notes nothing for an event that does not exist', async () => {
      const ghost = asEventId('nobody')

      expect(await ledger.note(ghost, 'jobDone', 'book@x', AT)).toBe(false)
      expect(await ledger.has(ghost, 'jobDone', 'book@x')).toBe(false)
    })

    it('refuses a kind the domain does not know: the table has no CHECK, so the vocabulary is judged here', async () => {
      await expect(ledger.note(EVENT, 'madeUp' as NoticeKind, 'x', AT)).rejects.toThrow(/kind/)
      expect(await ledger.has(EVENT, 'madeUp' as NoticeKind, 'x')).toBe(false)
    })
  })
}
