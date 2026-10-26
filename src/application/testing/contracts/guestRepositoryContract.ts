import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import { asEventId, asGuestId, type EventId, type GuestId } from '../../../domain/shared/ids'
import type { GuestRepository } from '../../ports/guestRepository'
import { AT, aGuest, atPlus } from '../builders'

/**
 * The shared `GuestRepository` contract.
 *
 * A guest belongs to exactly one event by construction, so the interesting cases are
 * the misses: a device token issued at one wedding names a guest row that must not
 * resolve at the next, and `findById` therefore takes the event id first.
 *
 * `photoCount` is asserted as what it is: a projection. The `guests` table has no such
 * column — the adapter derives the count from `photos.author_guest_id` — so a count a
 * saved guest carries is discarded, and the number a read returns is the number of photos
 * the guest took in their own event. A subject says how a photo gets authored
 * (`authorPhoto`), because the repository cannot write one. The per-guest upload limit is
 * tested against `PhotoRepository.countByAuthor`, which is the number the rule consults.
 */

/** What a subject files for a guest: a pending still unless told otherwise. */
export interface AuthoredPhoto {
  readonly status?: PhotoStatus
  readonly clip?: boolean
}

/** `guests.event_id` references `events`, so a subject must hold both events. */
export const GUEST_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
} as const

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const LEA = asGuestId('guest-lea')

export const guestRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{
    repo: GuestRepository
    /** Files one photograph taken by a guest, under the event the caller names. */
    authorPhoto: (eventId: EventId, guestId: GuestId, what?: AuthoredPhoto) => Promise<void>
    dispose?: () => Promise<void>
  }>,
): void => {
  describe(`GuestRepository contract: ${name}`, () => {
    let repo: GuestRepository
    let authorPhoto: (eventId: EventId, guestId: GuestId, what?: AuthoredPhoto) => Promise<void>
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      authorPhoto = subject.authorPhoto
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    // ------------------------------------------------------- derived photo count --

    it('counts the photos the guest took, which is the only copy of the number', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))
      await authorPhoto(WEDDING, LEA)
      await authorPhoto(WEDDING, LEA)

      expect((await repo.findById(WEDDING, LEA))?.photoCount).toBe(2)
    })

    it('counts nobody else’s photos towards a guest', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))
      await repo.save(aGuest({ id: 'guest-tom', eventId: WEDDING, displayName: 'Tom' }))
      await authorPhoto(WEDDING, asGuestId('guest-tom'))

      expect((await repo.findById(WEDDING, LEA))?.photoCount).toBe(0)
      expect((await repo.findById(WEDDING, asGuestId('guest-tom')))?.photoCount).toBe(1)
    })

    it('never counts a photo filed under another event towards a guest', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))
      await authorPhoto(WEDDING, LEA)
      await authorPhoto(GALA, LEA)

      expect((await repo.findById(WEDDING, LEA))?.photoCount).toBe(1)
    })

    it('counts every photo the guest took, whatever its status and whether a still or a clip', async () => {
      // The same rows `PhotoRepository.countByAuthor` counts for the upload limit: the host
      // sees how many a guest sent, not how many survived moderation.
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))
      await authorPhoto(WEDDING, LEA)
      await authorPhoto(WEDDING, LEA, { status: 'published' })
      await authorPhoto(WEDDING, LEA, { status: 'rejected' })
      await authorPhoto(WEDDING, LEA, { status: 'hidden' })
      await authorPhoto(WEDDING, LEA, { clip: true, status: 'published' })

      expect((await repo.findById(WEDDING, LEA))?.photoCount).toBe(5)
    })

    it('discards the count a saved guest carries, because no column stores it', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))
      await authorPhoto(WEDDING, LEA)
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, photoCount: 7 }))

      expect((await repo.findById(WEDDING, LEA))?.photoCount).toBe(1)
    })

    it('derives the count when listing the guests of an event too', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))
      await authorPhoto(WEDDING, LEA)

      const [listed] = await repo.list(WEDDING)

      expect(listed?.photoCount).toBe(1)
    })

    it('takes the photos with a guest who is erased, so the same guest saved again starts from none', async () => {
      // `photos.author_guest_id … ON DELETE CASCADE`: erasing a guest erases what they sent.
      const guest = aGuest({ id: 'guest-lea', eventId: WEDDING })
      await repo.save(guest)
      await authorPhoto(WEDDING, LEA)

      await repo.delete(WEDDING, LEA)
      await repo.save(guest)

      expect((await repo.findById(WEDDING, LEA))?.photoCount).toBe(0)
    })

    it('goes on counting after the guest is saved again, as when a heartbeat touches them', async () => {
      const guest = aGuest({ id: 'guest-lea', eventId: WEDDING })
      await repo.save(guest)
      await authorPhoto(WEDDING, LEA)

      await repo.save(guest.touch(atPlus(60_000)))

      expect((await repo.findById(WEDDING, LEA))?.photoCount).toBe(1)
    })

    // ------------------------------------------------------------ round trip --

    it('round-trips every stored field of a guest', async () => {
      await repo.save(
        aGuest({
          id: 'guest-lea',
          eventId: WEDDING,
          displayName: 'Léa',
          joinedAt: atPlus(1_000),
          lastSeenAt: atPlus(2_000),
          revokedAt: atPlus(3_000),
        }),
      )

      const stored = await repo.findById(WEDDING, asGuestId('guest-lea'))

      expect(stored?.eventId).toBe(WEDDING)
      expect(stored?.displayName?.value).toBe('Léa')
      expect(stored?.joinedAt.toISOString()).toBe(atPlus(1_000).toISOString())
      expect(stored?.lastSeenAt.toISOString()).toBe(atPlus(2_000).toISOString())
      expect(stored?.revokedAt?.toISOString()).toBe(atPlus(3_000).toISOString())
    })

    it('round-trips a guest who stayed anonymous', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, displayName: null }))

      const stored = await repo.findById(WEDDING, asGuestId('guest-lea'))

      expect(stored?.displayName).toBeNull()
      expect(stored?.label()).toBeNull()
    })

    it('round-trips an accented name unchanged, because it is projected as typed', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, displayName: 'Zoé Müller' }))

      expect((await repo.findById(WEDDING, asGuestId('guest-lea')))?.label()).toBe('Zoé Müller')
    })

    it('replaces the stored row when the same guest is saved again', async () => {
      const guest = aGuest({ id: 'guest-lea', eventId: WEDDING, lastSeenAt: AT })
      await repo.save(guest)

      await repo.save(guest.touch(atPlus(60_000)))

      const stored = await repo.findById(WEDDING, asGuestId('guest-lea'))
      expect(stored?.lastSeenAt.toISOString()).toBe(atPlus(60_000).toISOString())
    })

    it('round-trips the privacy notice a guest acknowledged, and when', async () => {
      await repo.save(
        aGuest({
          id: 'guest-lea',
          eventId: WEDDING,
          noticeAcknowledgement: {
            revision: 'publication=afterReview;retention=30',
            at: atPlus(4_000),
          },
        }),
      )

      const stored = await repo.findById(WEDDING, asGuestId('guest-lea'))

      expect(stored?.noticeAcknowledgement?.revision).toBe('publication=afterReview;retention=30')
      expect(stored?.noticeAcknowledgement?.at.toISOString()).toBe(atPlus(4_000).toISOString())
    })

    it('round-trips a guest who has not acknowledged any notice as having none', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))

      expect(
        (await repo.findById(WEDDING, asGuestId('guest-lea')))?.noticeAcknowledgement,
      ).toBeNull()
    })

    it('replaces an acknowledgement when the guest reads a newer notice', async () => {
      // The re-ask rule compares what was stored with what is in force, so a save that
      // kept the old revision would ask the guest again on every upload for the rest of
      // the evening.
      await repo.save(
        aGuest({
          id: 'guest-lea',
          eventId: WEDDING,
          noticeAcknowledgement: { revision: 'old', at: atPlus(1_000) },
        }),
      )

      await repo.save(
        aGuest({
          id: 'guest-lea',
          eventId: WEDDING,
          noticeAcknowledgement: { revision: 'new', at: atPlus(9_000) },
        }),
      )

      const stored = await repo.findById(WEDDING, asGuestId('guest-lea'))
      expect(stored?.noticeAcknowledgement?.revision).toBe('new')
      expect(stored?.noticeAcknowledgement?.at.toISOString()).toBe(atPlus(9_000).toISOString())
    })

    it('keeps an acknowledgement through an ordinary save of the same guest', async () => {
      // A phone re-scanning the code saves its row again (`joinEvent` touches it, and
      // renames it when a name is added), so a save that forgot the acknowledgement would
      // unread the notice every time a guest came back through the front door.
      const acknowledged = aGuest({
        id: 'guest-lea',
        eventId: WEDDING,
        lastSeenAt: AT,
        noticeAcknowledgement: { revision: 'r1', at: atPlus(1_000) },
      })
      await repo.save(acknowledged)

      await repo.save(acknowledged.touch(atPlus(60_000)))

      expect(
        (await repo.findById(WEDDING, asGuestId('guest-lea')))?.noticeAcknowledgement?.revision,
      ).toBe('r1')
    })

    it('records a revocation, so a removed guest token stops granting anything', async () => {
      const guest = aGuest({ id: 'guest-lea', eventId: WEDDING })
      await repo.save(guest)

      await repo.save(guest.revoke(atPlus(1_000)))

      expect((await repo.findById(WEDDING, asGuestId('guest-lea')))?.isRevoked()).toBe(true)
    })

    // ---------------------------------------------------------------- touch --

    it('records a later sighting of a guest', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, lastSeenAt: atPlus(1_000) }))

      await repo.touch(WEDDING, asGuestId('guest-lea'), atPlus(90_000))

      const stored = await repo.findById(WEDDING, asGuestId('guest-lea'))
      expect(stored?.lastSeenAt.toISOString()).toBe(atPlus(90_000).toISOString())
    })

    it('never moves a guest back to an earlier sighting', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, lastSeenAt: atPlus(90_000) }))

      await repo.touch(WEDDING, asGuestId('guest-lea'), atPlus(1_000))

      const stored = await repo.findById(WEDDING, asGuestId('guest-lea'))
      expect(stored?.lastSeenAt.toISOString()).toBe(atPlus(90_000).toISOString())
    })

    it('changes nothing of the row but when the guest was seen', async () => {
      // The reason it is not `save`: a stamp taken from a row read a moment ago must not put
      // a revoked guest back, take a name off, or forget a notice the guest just read.
      await repo.save(
        aGuest({
          id: 'guest-lea',
          eventId: WEDDING,
          displayName: 'Léa',
          revokedAt: atPlus(2_000),
          noticeAcknowledgement: { revision: 'r1', at: atPlus(3_000) },
        }),
      )

      await repo.touch(WEDDING, asGuestId('guest-lea'), atPlus(90_000))

      const stored = await repo.findById(WEDDING, asGuestId('guest-lea'))
      expect(stored?.displayName?.value).toBe('Léa')
      expect(stored?.revokedAt?.toISOString()).toBe(atPlus(2_000).toISOString())
      expect(stored?.noticeAcknowledgement?.revision).toBe('r1')
    })

    it('does not touch a guest of another event that has the same id', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: GALA, lastSeenAt: atPlus(1_000) }))

      await repo.touch(WEDDING, asGuestId('guest-lea'), atPlus(90_000))

      const stored = await repo.findById(GALA, asGuestId('guest-lea'))
      expect(stored?.lastSeenAt.toISOString()).toBe(atPlus(1_000).toISOString())
    })

    it('is not an error for a guest that does not exist', async () => {
      await expect(repo.touch(WEDDING, asGuestId('nope'), atPlus(1_000))).resolves.toBeUndefined()
    })

    // ----------------------------------------------------------------- misses --

    it('returns null for a guest id that does not exist', async () => {
      expect(await repo.findById(WEDDING, asGuestId('nope'))).toBeNull()
    })

    it('returns null for a guest that belongs to another event', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: GALA }))

      expect(await repo.findById(WEDDING, asGuestId('guest-lea'))).toBeNull()
    })

    // ----------------------------------------------------------- name batch --

    it('answers a batch with the name of each guest asked for', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, displayName: 'Léa' }))
      await repo.save(aGuest({ id: 'guest-sacha', eventId: WEDDING, displayName: 'Sacha' }))

      const names = await repo.findNamesByIds(WEDDING, [
        asGuestId('guest-lea'),
        asGuestId('guest-sacha'),
      ])

      // As a plain object: the port promises a lookup, not an order, and asserting one
      // would hold a SQL adapter to whatever `IN` happened to return.
      expect(Object.fromEntries(names)).toEqual({ 'guest-lea': 'Léa', 'guest-sacha': 'Sacha' })
    })

    it('omits a guest who stayed anonymous, so no caller invents a name for them', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, displayName: null }))

      const names = await repo.findNamesByIds(WEDDING, [asGuestId('guest-lea')])

      expect(names.has(asGuestId('guest-lea'))).toBe(false)
    })

    it('carries an accented name through the batch unchanged', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, displayName: 'Zoé Müller' }))

      const names = await repo.findNamesByIds(WEDDING, [asGuestId('guest-lea')])

      expect(names.get(asGuestId('guest-lea'))).toBe('Zoé Müller')
    })

    it('never returns the name of a guest at another event', async () => {
      // The wall is public. A batch that reached across events would put one party's
      // guest list on another party's projector.
      await repo.save(aGuest({ id: 'guest-sam', eventId: GALA, displayName: 'Sam' }))

      const names = await repo.findNamesByIds(WEDDING, [asGuestId('guest-sam')])

      expect([...names]).toEqual([])
    })

    it('omits a guest id nothing holds instead of failing the whole batch', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, displayName: 'Léa' }))

      const names = await repo.findNamesByIds(WEDDING, [
        asGuestId('guest-lea'),
        asGuestId('guest-gone'),
      ])

      expect([...names]).toEqual([['guest-lea', 'Léa']])
    })

    it('answers an empty request with an empty result', async () => {
      expect([...(await repo.findNamesByIds(WEDDING, []))]).toEqual([])
    })

    it('tolerates the same guest id repeated, because many slides share one sender', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, displayName: 'Léa' }))

      const names = await repo.findNamesByIds(WEDDING, [
        asGuestId('guest-lea'),
        asGuestId('guest-lea'),
      ])

      expect([...names]).toEqual([['guest-lea', 'Léa']])
    })

    it('still names a revoked guest, whose photos the host may have left published', async () => {
      // Revocation stops the device token granting anything. It is not a retraction of
      // the photos already on the wall — those are the host's to hide — and a slide that
      // silently lost its credit would look like a bug to the room.
      await repo.save(
        aGuest({
          id: 'guest-lea',
          eventId: WEDDING,
          displayName: 'Léa',
          revokedAt: atPlus(1_000),
        }),
      )

      const names = await repo.findNamesByIds(WEDDING, [asGuestId('guest-lea')])

      expect(names.get(asGuestId('guest-lea'))).toBe('Léa')
    })

    // --------------------------------------------------------------- listing --

    it('lists the most recently seen guest first', async () => {
      await repo.save(aGuest({ id: 'guest-early', eventId: WEDDING, lastSeenAt: atPlus(0) }))
      await repo.save(aGuest({ id: 'guest-late', eventId: WEDDING, lastSeenAt: atPlus(2_000) }))
      await repo.save(aGuest({ id: 'guest-mid', eventId: WEDDING, lastSeenAt: atPlus(1_000) }))

      const guests = await repo.list(WEDDING)

      expect(guests.map((guest) => guest.id)).toEqual(['guest-late', 'guest-mid', 'guest-early'])
    })

    it('breaks a presence tie by ascending id', async () => {
      await repo.save(aGuest({ id: 'guest-b', eventId: WEDDING, lastSeenAt: AT }))
      await repo.save(aGuest({ id: 'guest-a', eventId: WEDDING, lastSeenAt: AT }))

      const guests = await repo.list(WEDDING)

      expect(guests.map((guest) => guest.id)).toEqual(['guest-a', 'guest-b'])
    })

    it('lists the guests of one event only', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))
      await repo.save(aGuest({ id: 'guest-sam', eventId: GALA }))

      const guests = await repo.list(WEDDING)

      expect(guests.map((guest) => guest.id)).toEqual(['guest-lea'])
    })

    it('lists nothing for an event nobody has joined', async () => {
      expect(await repo.list(WEDDING)).toEqual([])
    })

    // -------------------------------------------------------------- presence --

    it('counts the guests seen inside the window', async () => {
      await repo.save(aGuest({ id: 'guest-here', eventId: WEDDING, lastSeenAt: atPlus(90_000) }))
      await repo.save(aGuest({ id: 'guest-gone', eventId: WEDDING, lastSeenAt: atPlus(0) }))

      expect(await repo.countActive(WEDDING, atPlus(60_000))).toBe(1)
    })

    it('counts a guest seen exactly at the window boundary', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, lastSeenAt: atPlus(60_000) }))

      expect(await repo.countActive(WEDDING, atPlus(60_000))).toBe(1)
    })

    it('never counts a revoked guest as being in the room', async () => {
      await repo.save(
        aGuest({
          id: 'guest-lea',
          eventId: WEDDING,
          lastSeenAt: atPlus(90_000),
          revokedAt: atPlus(95_000),
        }),
      )

      expect(await repo.countActive(WEDDING, atPlus(60_000))).toBe(0)
    })

    it('counts the guests of one event only', async () => {
      await repo.save(aGuest({ id: 'guest-sam', eventId: GALA, lastSeenAt: atPlus(90_000) }))

      expect(await repo.countActive(WEDDING, atPlus(60_000))).toBe(0)
    })

    it('counts nobody at an event nobody has joined', async () => {
      expect(await repo.countActive(WEDDING, atPlus(60_000))).toBe(0)
    })

    // ---------------------------------------------------------------- delete --

    it('deletes a guest', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))

      await repo.delete(WEDDING, asGuestId('guest-lea'))

      expect(await repo.findById(WEDDING, asGuestId('guest-lea'))).toBeNull()
    })

    it('is idempotent on delete', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))
      await repo.delete(WEDDING, asGuestId('guest-lea'))

      await expect(repo.delete(WEDDING, asGuestId('guest-lea'))).resolves.toBeUndefined()
    })

    it('does not delete a guest of the same id at another event', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: GALA }))

      await repo.delete(WEDDING, asGuestId('guest-lea'))

      expect((await repo.findById(GALA, asGuestId('guest-lea')))?.id).toBe('guest-lea')
    })
  })
}
