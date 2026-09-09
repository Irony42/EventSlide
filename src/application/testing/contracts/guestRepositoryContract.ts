import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import type { GuestRepository } from '../../ports/guestRepository'
import { AT, aGuest, atPlus } from '../builders'

/**
 * The shared `GuestRepository` contract.
 *
 * A guest belongs to exactly one event by construction, so the interesting cases are
 * the misses: a device token issued at one wedding names a guest row that must not
 * resolve at the next, and `findById` therefore takes the event id first.
 *
 * `photoCount` is deliberately not asserted through `save`. The `guests` table has no
 * such column — the adapter derives the count from `photos.author_guest_id` — so a
 * round-trip expectation would be a promise the schema cannot keep. The per-guest
 * upload limit is tested against `PhotoRepository.countByAuthor`, which is the number
 * the rule actually consults.
 */

/** `guests.event_id` references `events`, so a subject must hold both events. */
export const GUEST_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
} as const

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

export const guestRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{ repo: GuestRepository; dispose?: () => Promise<void> }>,
): void => {
  describe(`GuestRepository contract: ${name}`, () => {
    let repo: GuestRepository
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
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

    it('records a revocation, so a removed guest token stops granting anything', async () => {
      const guest = aGuest({ id: 'guest-lea', eventId: WEDDING })
      await repo.save(guest)

      await repo.save(guest.revoke(atPlus(1_000)))

      expect((await repo.findById(WEDDING, asGuestId('guest-lea')))?.isRevoked()).toBe(true)
    })

    // ----------------------------------------------------------------- misses --

    it('returns null for a guest id that does not exist', async () => {
      expect(await repo.findById(WEDDING, asGuestId('nope'))).toBeNull()
    })

    it('returns null for a guest that belongs to another event', async () => {
      await repo.save(aGuest({ id: 'guest-lea', eventId: GALA }))

      expect(await repo.findById(WEDDING, asGuestId('guest-lea'))).toBeNull()
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
