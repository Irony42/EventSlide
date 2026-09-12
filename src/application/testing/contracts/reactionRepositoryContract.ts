import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REACTION_KINDS } from '../../../domain/reactions/reactionKind'
import { asEventId, asGuestId, asPhotoId } from '../../../domain/shared/ids'
import type { ReactionRepository } from '../../ports/reactionRepository'
import { AT, aReaction, atPlus } from '../builders'

/**
 * The shared `ReactionRepository` contract.
 *
 * Two keys are being tested at once, and they are deliberately different:
 *
 * - **Reads are event-scoped**, like every other read in this codebase.
 * - **Uniqueness is not.** `idx_reactions_unique` is on `(photo_id, guest_id, kind)`
 *   alone, because a photo already belongs to exactly one event. So the same reaction
 *   re-sent — a double tap on a phone that lost signal — is refused whatever event id
 *   accompanies it, and a count on the wall cannot be inflated by a retry.
 */

/** `reactions` references `events`, `photos` and `guests`. */
export const REACTION_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  /** `p1` and `p2` belong to the wedding, `p9` to the gala. */
  photoIds: ['p1', 'p2', 'p9'],
  /** `guest-lea` and `guest-nils` joined the wedding, `guest-sam` the gala. */
  guestIds: ['guest-lea', 'guest-nils', 'guest-sam'],
} as const

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const P1 = asPhotoId('p1')
const P2 = asPhotoId('p2')
const P9 = asPhotoId('p9')
const LEA = asGuestId('guest-lea')
const NILS = asGuestId('guest-nils')
const SAM = asGuestId('guest-sam')

const noReactions = { love: 0, laugh: 0, wow: 0, cheers: 0, clap: 0 }

export const reactionRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{ repo: ReactionRepository; dispose?: () => Promise<void> }>,
): void => {
  describe(`ReactionRepository contract: ${name}`, () => {
    let repo: ReactionRepository
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

    it('round-trips every field of a saved reaction', async () => {
      await repo.save(
        aReaction({
          id: 'r1',
          eventId: WEDDING,
          photoId: P1,
          guestId: LEA,
          kind: 'cheers',
          createdAt: atPlus(1_000),
        }),
      )

      const stored = await repo.findOne(WEDDING, P1, LEA, 'cheers')

      expect(stored?.id).toBe('r1')
      expect(stored?.eventId).toBe(WEDDING)
      expect(stored?.photoId).toBe(P1)
      expect(stored?.guestId).toBe(LEA)
      expect(stored?.kind).toBe('cheers')
      expect(stored?.createdAt.toISOString()).toBe(atPlus(1_000).toISOString())
    })

    it.each([...REACTION_KINDS])('round-trips a %s reaction', async (kind) => {
      await repo.save(aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind }))

      expect((await repo.findOne(WEDDING, P1, LEA, kind))?.kind).toBe(kind)
    })

    // ----------------------------------------------------------------- misses --

    it('returns null for a kind the guest has not sent', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )

      expect(await repo.findOne(WEDDING, P1, LEA, 'clap')).toBeNull()
    })

    it('returns null for another guest reaction', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: NILS, kind: 'love' }),
      )

      expect(await repo.findOne(WEDDING, P1, LEA, 'love')).toBeNull()
    })

    it('returns null for a reaction on another photo', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P2, guestId: LEA, kind: 'love' }),
      )

      expect(await repo.findOne(WEDDING, P1, LEA, 'love')).toBeNull()
    })

    it('returns null for a reaction that belongs to another event', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: GALA, photoId: P9, guestId: SAM, kind: 'love' }),
      )

      expect(await repo.findOne(WEDDING, P9, SAM, 'love')).toBeNull()
    })

    // ------------------------------------------------------------ uniqueness --

    it('refuses a second reaction of the same kind by the same guest on the same photo', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )

      await expect(
        repo.save(
          aReaction({ id: 'r2', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
        ),
      ).rejects.toThrow()
    })

    it('refuses the same reaction re-sent under a different event id', async () => {
      // The unique index does not carry `event_id`, because a photo belongs to exactly
      // one event: a retry that claims the wrong one must not create a second row.
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )

      await expect(
        repo.save(aReaction({ id: 'r2', eventId: GALA, photoId: P1, guestId: LEA, kind: 'love' })),
      ).rejects.toThrow()
    })

    it('accepts a second kind from the same guest on the same photo', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )

      await repo.save(
        aReaction({ id: 'r2', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'clap' }),
      )

      expect((await repo.findOne(WEDDING, P1, LEA, 'clap'))?.id).toBe('r2')
    })

    it('accepts the same kind from another guest on the same photo', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )

      await repo.save(
        aReaction({ id: 'r2', eventId: WEDDING, photoId: P1, guestId: NILS, kind: 'love' }),
      )

      expect((await repo.countsFor(WEDDING, P1)).love).toBe(2)
    })

    // ---------------------------------------------------------------- counts --

    it('counts every kind on a photo', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )
      await repo.save(
        aReaction({ id: 'r2', eventId: WEDDING, photoId: P1, guestId: NILS, kind: 'love' }),
      )
      await repo.save(
        aReaction({ id: 'r3', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'wow' }),
      )

      expect(await repo.countsFor(WEDDING, P1)).toEqual({ ...noReactions, love: 2, wow: 1 })
    })

    it('reports a zero for every kind on a photo nobody reacted to', async () => {
      expect(await repo.countsFor(WEDDING, P1)).toEqual(noReactions)
    })

    it('counts the reactions of one photo only', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P2, guestId: LEA, kind: 'love' }),
      )

      expect(await repo.countsFor(WEDDING, P1)).toEqual(noReactions)
    })

    it('never counts a reaction recorded under another event', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: GALA, photoId: P9, guestId: SAM, kind: 'love' }),
      )

      expect(await repo.countsFor(WEDDING, P9)).toEqual(noReactions)
    })

    it('tallies an event photo by photo', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )
      await repo.save(
        aReaction({ id: 'r2', eventId: WEDDING, photoId: P2, guestId: LEA, kind: 'clap' }),
      )

      const byPhoto = await repo.countsForEvent(WEDDING)

      expect([...byPhoto.entries()]).toEqual(
        expect.arrayContaining([
          [P1, { ...noReactions, love: 1 }],
          [P2, { ...noReactions, clap: 1 }],
        ]),
      )
    })

    it('leaves a photo nobody reacted to out of the event tally', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )

      expect((await repo.countsForEvent(WEDDING)).has(P2)).toBe(false)
    })

    it('tallies one event only', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: GALA, photoId: P9, guestId: SAM, kind: 'love' }),
      )

      expect((await repo.countsForEvent(WEDDING)).size).toBe(0)
    })

    // ----------------------------------------------------------- guest views --

    it('lists what a guest has already sent, newest first', async () => {
      await repo.save(
        aReaction({
          id: 'r1',
          eventId: WEDDING,
          photoId: P1,
          guestId: LEA,
          kind: 'love',
          createdAt: atPlus(0),
        }),
      )
      await repo.save(
        aReaction({
          id: 'r2',
          eventId: WEDDING,
          photoId: P2,
          guestId: LEA,
          kind: 'clap',
          createdAt: atPlus(1_000),
        }),
      )

      const entries = await repo.listByGuest(WEDDING, LEA)

      expect(entries).toEqual([
        { kind: 'clap', guestId: LEA },
        { kind: 'love', guestId: LEA },
      ])
    })

    it('never lists another guest reactions', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: NILS, kind: 'love' }),
      )

      expect(await repo.listByGuest(WEDDING, LEA)).toEqual([])
    })

    it('lists a guest reactions for one event only', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: GALA, photoId: P9, guestId: LEA, kind: 'love' }),
      )

      expect(await repo.listByGuest(WEDDING, LEA)).toEqual([])
    })

    // -------------------------------------------------------------- anti-spam --

    it('counts the reactions a guest sent inside the window', async () => {
      await repo.save(
        aReaction({
          id: 'r1',
          eventId: WEDDING,
          photoId: P1,
          guestId: LEA,
          kind: 'love',
          createdAt: atPlus(0),
        }),
      )
      await repo.save(
        aReaction({
          id: 'r2',
          eventId: WEDDING,
          photoId: P2,
          guestId: LEA,
          kind: 'love',
          createdAt: atPlus(90_000),
        }),
      )

      expect(await repo.countByGuestSince(WEDDING, LEA, atPlus(60_000))).toBe(1)
    })

    it('counts a reaction sent exactly at the window boundary', async () => {
      await repo.save(
        aReaction({
          id: 'r1',
          eventId: WEDDING,
          photoId: P1,
          guestId: LEA,
          kind: 'love',
          createdAt: atPlus(60_000),
        }),
      )

      expect(await repo.countByGuestSince(WEDDING, LEA, atPlus(60_000))).toBe(1)
    })

    it('never spends one guest budget on another guest reactions', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: NILS, kind: 'love' }),
      )

      expect(await repo.countByGuestSince(WEDDING, LEA, AT)).toBe(0)
    })

    it('counts a guest budget for one event only', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: GALA, photoId: P9, guestId: LEA, kind: 'love' }),
      )

      expect(await repo.countByGuestSince(WEDDING, LEA, AT)).toBe(0)
    })

    // ---------------------------------------------------------------- delete --

    it('withdraws a reaction', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )

      await repo.delete(WEDDING, P1, LEA, 'love')

      expect(await repo.findOne(WEDDING, P1, LEA, 'love')).toBeNull()
    })

    it('is idempotent on withdrawal', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )
      await repo.delete(WEDDING, P1, LEA, 'love')

      await expect(repo.delete(WEDDING, P1, LEA, 'love')).resolves.toBeUndefined()
    })

    it('withdraws one kind and leaves the guest other reactions on the photo', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )
      await repo.save(
        aReaction({ id: 'r2', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'clap' }),
      )

      await repo.delete(WEDDING, P1, LEA, 'love')

      expect((await repo.findOne(WEDDING, P1, LEA, 'clap'))?.id).toBe('r2')
    })

    it('never withdraws a reaction through the wrong event', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: GALA, photoId: P9, guestId: SAM, kind: 'love' }),
      )

      await repo.delete(WEDDING, P9, SAM, 'love')

      expect((await repo.findOne(GALA, P9, SAM, 'love'))?.id).toBe('r1')
    })

    it('frees the kind once withdrawn, so a guest can react again', async () => {
      await repo.save(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )
      await repo.delete(WEDDING, P1, LEA, 'love')

      await repo.save(
        aReaction({ id: 'r2', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      )

      expect((await repo.findOne(WEDDING, P1, LEA, 'love'))?.id).toBe('r2')
    })
  })
}
