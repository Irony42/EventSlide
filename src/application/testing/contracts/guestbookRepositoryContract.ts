import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_ENTRIES_PER_EVENT, MAX_ENTRIES_PER_GUEST } from '../../../domain/guestbook/guestbookLimits'
import {
  asEventId,
  asGuestId,
  asGuestbookEntryId,
  asUserId,
  type GuestbookEntryId,
} from '../../../domain/shared/ids'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import { aGuestbookEntry } from '../builders'

/**
 * The behaviour every `GuestbookRepository` must have, run against the fake **and** SQLite.
 *
 * The two decide the ceilings and the duplicate window in different code (an array filter and a
 * transaction over three statements), so a fake that counted a refused message toward the book,
 * or that forgot a taken-down row still holds its author's place, would make every ring-2 test
 * about the guestbook prove the opposite of what production does.
 */

/** The rows the SQLite side needs to exist before the contract runs; the fake ignores them. */
export const GUESTBOOK_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  guestIds: ['guest-lea', 'guest-sam'],
  /** Guests numbered for the cases that need a crowd (the event ceiling). */
  crowd: 200,
  userIds: ['user-host'],
} as const

export const crowdGuestId = (n: number): string => `guest-crowd-${n}`

export interface GuestbookRepositorySubject {
  readonly repo: GuestbookRepository
  /** What `setPhotoTakedown`-style code will do through the port later: set `taken_down_at`. */
  readonly takeDown: (eventId: string, entryId: string, at: Date) => void
  readonly dispose?: () => Promise<void>
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const LEA = asGuestId('guest-lea')
const SAM = asGuestId('guest-sam')
const entryId = (raw: string): GuestbookEntryId => asGuestbookEntryId(raw)

const at = (seconds: number): Date => new Date(Date.UTC(2026, 5, 20, 21, 0, seconds))

/** A message of the wedding, by Lea, unless a case says otherwise. */
const entry = (input: Parameters<typeof aGuestbookEntry>[0] = {}) =>
  aGuestbookEntry({ eventId: 'evt-wedding', guestId: 'guest-lea', ...input })

export const guestbookRepositoryContract = (
  name: string,
  makeSubject: () => Promise<GuestbookRepositorySubject>,
): void => {
  describe(`GuestbookRepository contract: ${name}`, () => {
    let subject: GuestbookRepositorySubject
    let repo: GuestbookRepository

    beforeEach(async () => {
      if (subject?.dispose !== undefined) await subject.dispose()
      subject = await makeSubject()
      repo = subject.repo
    })

    // ------------------------------------------------------------- tenant isolation --

    it('finds a message by id and event, and not through another event', async () => {
      await repo.admit(entry({ id: 'e1' }))

      expect((await repo.findById(WEDDING, entryId('e1')))?.id).toBe('e1')
      expect(await repo.findById(GALA, entryId('e1'))).toBeNull()
    })

    it('never lists another event message among a guest own', async () => {
      await repo.admit(entry({ id: 'e1' }))
      await repo.admit(entry({ id: 'e2', eventId: 'evt-gala', guestId: 'guest-lea' }))

      expect((await repo.listByGuest(WEDDING, LEA, 10)).map((row) => row.id)).toEqual(['e1'])
    })

    it('does not delete another event message by id', async () => {
      await repo.admit(entry({ id: 'e1' }))

      await repo.delete(GALA, entryId('e1'))

      expect(await repo.findById(WEDDING, entryId('e1'))).not.toBeNull()
    })

    it('does not erase another event messages of the same guest id', async () => {
      await repo.admit(entry({ id: 'e1' }))

      expect(await repo.deleteByGuest(GALA, LEA)).toBe(0)
      expect(await repo.findById(WEDDING, entryId('e1'))).not.toBeNull()
    })

    // ------------------------------------------------------------------ reads --

    it('round-trips a message with its status, its review and its text', async () => {
      await repo.admit(entry({ id: 'e1', text: 'Bravo\n\nBonne route', createdAt: at(5) }))
      await repo.admit(entry({ id: 'e2', moderation: 'auto', createdAt: at(6) }))

      const manual = await repo.findById(WEDDING, entryId('e1'))
      const auto = await repo.findById(WEDDING, entryId('e2'))

      expect(manual?.text.value).toBe('Bravo\n\nBonne route')
      expect(manual?.status).toBe('pending')
      expect(manual?.review).toBeNull()
      expect(manual?.createdAt.toISOString()).toBe(at(5).toISOString())
      expect(auto?.status).toBe('published')
      expect(auto?.review).toEqual({ kind: 'automatic', at: at(6) })
    })

    it('lists a guest own messages newest first and honours the limit', async () => {
      await repo.admit(entry({ id: 'a', text: 'a', createdAt: at(1) }))
      await repo.admit(entry({ id: 'b', text: 'b', createdAt: at(2) }))
      await repo.admit(entry({ id: 'c', text: 'c', createdAt: at(3) }))

      expect((await repo.listByGuest(WEDDING, LEA, 10)).map((row) => row.id)).toEqual(['c', 'b', 'a'])
      expect((await repo.listByGuest(WEDDING, LEA, 2)).map((row) => row.id)).toEqual(['c', 'b'])
    })

    it('does not list another guest message', async () => {
      await repo.admit(entry({ id: 'e1' }))
      await repo.admit(entry({ id: 'e2', guestId: 'guest-sam' }))

      expect((await repo.listByGuest(WEDDING, SAM, 10)).map((row) => row.id)).toEqual(['e2'])
    })

    // ---------------------------------------------------------------- admission --

    it('treats the same text from the same guest within a minute as one message', async () => {
      const first = await repo.admit(entry({ id: 'e1', text: 'Merci', createdAt: at(0) }))
      const again = await repo.admit(entry({ id: 'e2', text: 'Merci', createdAt: at(59) }))

      expect(first.kind).toBe('added')
      expect(again.kind).toBe('duplicate')
      expect(again.kind === 'duplicate' && again.entry.id).toBe('e1')
      expect(await repo.countByGuest(WEDDING, LEA)).toBe(1)
    })

    it('treats the same text a minute later as a new message', async () => {
      await repo.admit(entry({ id: 'e1', text: 'Merci', createdAt: at(0) }))
      const later = await repo.admit(entry({ id: 'e2', text: 'Merci', createdAt: at(60) }))

      expect(later.kind).toBe('added')
    })

    it('does not mistake the same text from another guest for a duplicate', async () => {
      await repo.admit(entry({ id: 'e1', text: 'Merci', createdAt: at(0) }))
      const other = await repo.admit(
        entry({ id: 'e2', guestId: 'guest-sam', text: 'Merci', createdAt: at(1) }),
      )

      expect(other.kind).toBe('added')
    })

    it('answers a duplicate before the ceiling, so a guest at the limit who double-taps is told sent', async () => {
      for (let n = 0; n < MAX_ENTRIES_PER_GUEST; n += 1) {
        await repo.admit(entry({ id: `e${n}`, text: `m${n}`, createdAt: at(n) }))
      }

      const again = await repo.admit(entry({ id: 'x', text: `m${MAX_ENTRIES_PER_GUEST - 1}`, createdAt: at(10) }))

      expect(again.kind).toBe('duplicate')
    })

    it('accepts the third message of a guest and refuses the fourth', async () => {
      const results = []
      for (let n = 0; n < MAX_ENTRIES_PER_GUEST + 1; n += 1) {
        results.push(await repo.admit(entry({ id: `e${n}`, text: `m${n}`, createdAt: at(n * 100) })))
      }

      expect(results.map((result) => result.kind)).toEqual(['added', 'added', 'added', 'refused'])
      const refused = results[MAX_ENTRIES_PER_GUEST]
      expect(refused?.kind === 'refused' && refused.refusal).toBe('guestLimit')
    })

    const reject = async (id: string): Promise<void> => {
      const stored = await repo.findById(WEDDING, entryId(id))
      const rejected = stored?.reject({ kind: 'automatic' }, at(1))
      if (rejected === undefined || !rejected.ok) throw new Error('setup: reject failed')
      await repo.save(rejected.value)
    }

    it('counts a rejected message toward the guest, so being refused does not free a place', async () => {
      await repo.admit(entry({ id: 'e1' }))
      await reject('e1')

      expect((await repo.findById(WEDDING, entryId('e1')))?.status).toBe('rejected')
      expect(await repo.countByGuest(WEDDING, LEA)).toBe(1)
    })

    it('does not count a rejected message toward the event, so the host can always reopen the book', async () => {
      await repo.admit(entry({ id: 'e1', text: 'a' }))
      await repo.admit(entry({ id: 'e2', text: 'b', createdAt: at(100) }))
      await reject('e1')

      expect(await repo.countOpenByEvent(WEDDING)).toBe(1)
    })

    it('saves a decision with its reviewer and does not resurrect a deleted message', async () => {
      await repo.admit(entry({ id: 'e1' }))
      const stored = await repo.findById(WEDDING, entryId('e1'))
      const published = stored?.publish({ kind: 'host', userId: asUserId('user-host') }, at(9))
      if (published === undefined || !published.ok) throw new Error('setup: publish failed')

      await repo.save(published.value)
      const reread = await repo.findById(WEDDING, entryId('e1'))
      await repo.delete(WEDDING, entryId('e1'))
      await repo.save(published.value)

      expect(reread?.status).toBe('published')
      expect(reread?.review).toEqual({ kind: 'host', userId: 'user-host', at: at(9) })
      expect(await repo.findById(WEDDING, entryId('e1'))).toBeNull()
    })

    it('keeps a message the operator took down in the guest count, and out of every read', async () => {
      await repo.admit(entry({ id: 'e1' }))
      subject.takeDown('evt-wedding', 'e1', at(5))

      expect(await repo.countByGuest(WEDDING, LEA)).toBe(1)
      expect(await repo.findById(WEDDING, entryId('e1'))).toBeNull()
      expect(await repo.listByGuest(WEDDING, LEA, 10)).toEqual([])
      expect(await repo.countOpenByEvent(WEDDING)).toBe(0)
      expect(await repo.countTakenDownBy(WEDDING, LEA)).toBe(1)
    })

    it('does not let a taken-down message count as a duplicate to hide behind', async () => {
      await repo.admit(entry({ id: 'e1', text: 'Merci', createdAt: at(0) }))
      subject.takeDown('evt-wedding', 'e1', at(1))

      const again = await repo.admit(entry({ id: 'e2', text: 'Merci', createdAt: at(2) }))

      expect(again.kind).toBe('added')
    })

    it('holds the event ceiling at 500 open messages and names it', async () => {
      const crowd = GUESTBOOK_CONTRACT_FIXTURES.crowd
      // 500 messages from 200 guests, three each at most, so the guest ceiling never fires first.
      for (let n = 0; n < MAX_ENTRIES_PER_EVENT; n += 1) {
        const guest = crowdGuestId(n % crowd)
        const admitted = await repo.admit(
          entry({ id: `c${n}`, guestId: guest, text: `m${n}`, createdAt: at(n) }),
        )
        expect(admitted.kind).toBe('added')
      }

      const over = await repo.admit(entry({ id: 'over', text: 'one more', createdAt: at(9_000) }))

      expect(over.kind === 'refused' && over.refusal).toBe('eventFull')
      expect(await repo.countOpenByEvent(WEDDING)).toBe(MAX_ENTRIES_PER_EVENT)
    })

    it('does not count another event messages toward this event ceiling', async () => {
      await repo.admit(entry({ id: 'g1', eventId: 'evt-gala', guestId: 'guest-lea' }))

      expect(await repo.countOpenByEvent(WEDDING)).toBe(0)
      expect(await repo.countOpenByEvent(GALA)).toBe(1)
    })

    // ---------------------------------------------------------------- deletion --

    it('deletes one message and nothing else, and deleting twice is harmless', async () => {
      await repo.admit(entry({ id: 'e1', text: 'a' }))
      await repo.admit(entry({ id: 'e2', text: 'b', createdAt: at(100) }))

      await repo.delete(WEDDING, entryId('e1'))
      await repo.delete(WEDDING, entryId('e1'))

      expect(await repo.findById(WEDDING, entryId('e1'))).toBeNull()
      expect(await repo.findById(WEDDING, entryId('e2'))).not.toBeNull()
    })

    it('erases a guest messages, counts them, and leaves another guest alone', async () => {
      await repo.admit(entry({ id: 'e1', text: 'a' }))
      await repo.admit(entry({ id: 'e2', text: 'b', createdAt: at(100) }))
      await repo.admit(entry({ id: 'e3', guestId: 'guest-sam', text: 'c' }))

      expect(await repo.deleteByGuest(WEDDING, LEA)).toBe(2)

      expect(await repo.countByGuest(WEDDING, LEA)).toBe(0)
      expect(await repo.countByGuest(WEDDING, SAM)).toBe(1)
    })

    it('keeps and does not count a message the operator took down when erasing', async () => {
      await repo.admit(entry({ id: 'e1', text: 'a' }))
      await repo.admit(entry({ id: 'e2', text: 'b', createdAt: at(100) }))
      subject.takeDown('evt-wedding', 'e2', at(200))

      expect(await repo.deleteByGuest(WEDDING, LEA)).toBe(1)

      expect(await repo.countTakenDownBy(WEDDING, LEA)).toBe(1)
      expect(await repo.countByGuest(WEDDING, LEA)).toBe(1)
    })
  })
}
