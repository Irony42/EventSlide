import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_RSVPS_PER_EVENT } from '../../../domain/guestRsvps/rsvpLimits'
import { aRsvp } from '../../../domain/guestRsvps/testing/rsvpFixtures'
import {
  asEventId,
  asGuestRsvpId,
  asUserId,
  type EventId,
  type UserId,
} from '../../../domain/shared/ids'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'

/**
 * The behaviour every `GuestRsvpRepository` must have, run against the fake **and** SQLite: every
 * lookup scoped by the event (a token digest too), an admission that decides its ceilings in one
 * step, a change that never moves identity, and the expiry of replies by their event's dates.
 */

/** Rows the SQLite harness must create before the contract runs; the fake ignores them. */
export const GUEST_RSVP_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  userIds: ['user-host', 'user-other'],
} as const

export interface GuestRsvpRepositorySubject {
  readonly repo: GuestRsvpRepository
  /** Sets what the event's `closed_at` and its invitation's start say, for the expiry. */
  /** Makes the user a member of the event, as an `event_memberships` row does. */
  readonly addMember: (eventId: EventId, userId: UserId) => Promise<void>
  readonly setEventDates: (
    eventId: EventId,
    dates: { readonly closedAt: Date | null; readonly startsAt: Date | null },
  ) => Promise<void>
  readonly dispose?: () => Promise<void>
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const NONE = { capacity: null } as const

const T0 = new Date('2026-11-22T10:00:00.000Z')
const T1 = new Date('2026-11-22T11:00:00.000Z')
const T2 = new Date('2026-11-22T12:00:00.000Z')

export const guestRsvpRepositoryContract = (
  name: string,
  makeSubject: () => Promise<GuestRsvpRepositorySubject>,
): void => {
  describe(`GuestRsvpRepository contract: ${name}`, () => {
    let subject: GuestRsvpRepositorySubject
    let repo: GuestRsvpRepository

    beforeEach(async () => {
      if (subject?.dispose !== undefined) await subject.dispose()
      subject = await makeSubject()
      repo = subject.repo
    })

    const add = async (overrides: Parameters<typeof aRsvp>[0]) => {
      const outcome = await repo.admit(aRsvp({ eventId: 'evt-wedding', ...overrides }), NONE)
      if (outcome.kind !== 'added') throw new Error(`not added: ${outcome.kind}`)
      return outcome.rsvp
    }

    describe('reading', () => {
      it('has no reply until one is admitted', async () => {
        expect(await repo.listByEvent(WEDDING)).toEqual([])
        expect(await repo.findById(WEDDING, asGuestRsvpId('rsvp-1'))).toBeNull()
        expect(await repo.findByEditTokenHash(WEDDING, 'digest')).toBeNull()
        expect(await repo.findByHousehold(WEDDING, 'h-1')).toBeNull()
      })

      it('keeps everything a reply holds, to the letter', async () => {
        const stored = await add({
          id: 'rsvp-1',
          editTokenHash: 'digest-1',
          householdId: 'h-1',
          name: 'Léa « Lélé » Martin',
          answer: 'maybe',
          adults: 2,
          kids: 1,
          diet: 'sans gluten, "noix"',
          message: 'On vient\navec plaisir ; à samedi',
          source: 'household',
          details: {
            companions: ['', 'Inès'],
            meals: ['', 'Végétarien'],
            answers: [{ questionId: 'q1', label: 'Voiture ?', value: 'oui' }],
            moments: ['m1'],
            showName: true,
          },
          createdAt: T0,
          updatedAt: T1,
        })

        const read = await repo.findById(WEDDING, asGuestRsvpId('rsvp-1'))

        expect(read?.toProps()).toEqual(stored.toProps())
        expect(read?.createdAt.toISOString()).toBe(T0.toISOString())
        expect(read?.updatedAt.toISOString()).toBe(T1.toISOString())
      })

      it('keeps a reply typed by the host, which has no token', async () => {
        await add({ id: 'rsvp-1', source: 'host', editTokenHash: null, diet: null, message: null })

        const read = await repo.findById(WEDDING, asGuestRsvpId('rsvp-1'))

        expect(read?.editTokenHash).toBeNull()
        expect(read?.source).toBe('host')
        expect(read?.diet).toBeNull()
        expect(read?.message).toBeNull()
      })

      it('lists the most recently changed first, the greater id first on a tie', async () => {
        await add({ id: 'rsvp-a', updatedAt: T0 })
        await add({ id: 'rsvp-c', updatedAt: T2 })
        await add({ id: 'rsvp-b', updatedAt: T1 })
        await add({ id: 'rsvp-d', updatedAt: T1 })

        const ids = (await repo.listByEvent(WEDDING)).map((rsvp) => rsvp.id)

        expect(ids).toEqual(['rsvp-c', 'rsvp-d', 'rsvp-b', 'rsvp-a'])
      })

      it('never answers a reply of another event, by id, by token digest or by household', async () => {
        await repo.admit(
          aRsvp({
            id: 'rsvp-gala',
            eventId: 'evt-gala',
            editTokenHash: 'digest-gala',
            householdId: 'h-gala',
          }),
          NONE,
        )

        expect(await repo.listByEvent(WEDDING)).toEqual([])
        expect(await repo.findById(WEDDING, asGuestRsvpId('rsvp-gala'))).toBeNull()
        expect(await repo.findByEditTokenHash(WEDDING, 'digest-gala')).toBeNull()
        expect(await repo.findByHousehold(WEDDING, 'h-gala')).toBeNull()
        expect((await repo.findByEditTokenHash(GALA, 'digest-gala'))?.id).toBe('rsvp-gala')
        expect((await repo.findByHousehold(GALA, 'h-gala'))?.id).toBe('rsvp-gala')
        expect((await repo.listByEvent(GALA)).map((rsvp) => rsvp.id)).toEqual(['rsvp-gala'])
      })

      it('finds a reply by the digest of its token and by its household', async () => {
        await add({ id: 'rsvp-1', editTokenHash: 'digest-1', householdId: 'h-1' })
        await add({ id: 'rsvp-2', editTokenHash: 'digest-2', householdId: null })

        expect((await repo.findByEditTokenHash(WEDDING, 'digest-2'))?.id).toBe('rsvp-2')
        expect(await repo.findByEditTokenHash(WEDDING, 'digest-3')).toBeNull()
        expect((await repo.findByHousehold(WEDDING, 'h-1'))?.id).toBe('rsvp-1')
        expect(await repo.findByHousehold(WEDDING, 'h-2')).toBeNull()
      })
    })

    describe('admit: adding and changing', () => {
      it('adds a new reply and answers it', async () => {
        const outcome = await repo.admit(aRsvp({ eventId: 'evt-wedding', id: 'rsvp-1' }), NONE)

        expect(outcome.kind).toBe('added')
        expect((await repo.listByEvent(WEDDING)).map((rsvp) => rsvp.id)).toEqual(['rsvp-1'])
      })

      it('changes the content of a reply it already holds and keeps its identity', async () => {
        await add({
          id: 'rsvp-1',
          editTokenHash: 'digest-1',
          source: 'open',
          householdId: 'h-1',
          name: 'Léa',
          createdAt: T0,
        })

        const outcome = await repo.admit(
          aRsvp({
            id: 'rsvp-1',
            eventId: 'evt-wedding',
            editTokenHash: 'ignored',
            source: 'host',
            householdId: null,
            name: 'Léa M.',
            answer: 'maybe',
            adults: 3,
            kids: 1,
            diet: 'noix',
            message: 'Peut-être',
            createdAt: T2,
          }),
          NONE,
        )

        expect(outcome.kind).toBe('updated')
        const read = await repo.findById(WEDDING, asGuestRsvpId('rsvp-1'))
        expect(read?.toProps()).toMatchObject({
          editTokenHash: 'digest-1',
          source: 'open',
          householdId: 'h-1',
          createdAt: T0,
          name: 'Léa M.',
          answer: 'maybe',
          adults: 3,
          kids: 1,
          diet: 'noix',
          message: 'Peut-être',
          updatedAt: T2,
        })
        expect(outcome.kind === 'updated' && outcome.rsvp.toProps()).toEqual(read?.toProps())
        expect(await repo.listByEvent(WEDDING)).toHaveLength(1)
      })

      it('holds one reply per household: a second reply changes the first one', async () => {
        await add({ id: 'rsvp-1', householdId: 'h-1', name: 'Famille Martin', adults: 2 })

        const outcome = await repo.admit(
          aRsvp({
            id: 'rsvp-2',
            eventId: 'evt-wedding',
            householdId: 'h-1',
            name: 'Famille Martin',
            adults: 4,
          }),
          NONE,
        )

        expect(outcome.kind === 'updated' && outcome.rsvp.id).toBe('rsvp-1')
        const all = await repo.listByEvent(WEDDING)
        expect(all.map((rsvp) => [rsvp.id, rsvp.adults])).toEqual([['rsvp-1', 4]])
      })

      it('does not tie two events through the same household id', async () => {
        await add({ id: 'rsvp-1', householdId: 'h-1' })

        const outcome = await repo.admit(
          aRsvp({ id: 'rsvp-2', eventId: 'evt-gala', householdId: 'h-1' }),
          NONE,
        )

        expect(outcome.kind).toBe('added')
      })
    })

    describe('admit: a change only', () => {
      it('changes a reply that is there, like any change', async () => {
        await add({ id: 'rsvp-1', name: 'Avant' })

        const outcome = await repo.admit(
          aRsvp({ eventId: 'evt-wedding', id: 'rsvp-1', name: 'Après' }),
          { capacity: null, changeOnly: true },
        )

        expect(outcome.kind).toBe('updated')
        expect((await repo.findById(WEDDING, asGuestRsvpId('rsvp-1')))?.name).toBe('Après')
      })

      it('does not store again a reply that was deleted meanwhile', async () => {
        await add({ id: 'rsvp-1', editTokenHash: 'digest-1' })
        await repo.delete(WEDDING, asGuestRsvpId('rsvp-1'))

        const outcome = await repo.admit(
          aRsvp({ eventId: 'evt-wedding', id: 'rsvp-1', editTokenHash: 'digest-1' }),
          { capacity: null, changeOnly: true },
        )

        expect(outcome).toEqual({ kind: 'gone' })
        expect(await repo.listByEvent(WEDDING)).toEqual([])
      })

      it('does not take the reply of another event for its own', async () => {
        await repo.admit(aRsvp({ eventId: 'evt-gala', id: 'rsvp-1' }), NONE)

        const outcome = await repo.admit(aRsvp({ eventId: 'evt-wedding', id: 'rsvp-1' }), {
          capacity: null,
          changeOnly: true,
        })

        expect(outcome.kind).toBe('gone')
      })
    })

    describe('admit: the ceilings', () => {
      const fill = async (count: number): Promise<void> => {
        for (let i = 0; i < count; i += 1) {
          await add({ id: `rsvp-${i}`, answer: 'no' })
        }
      }

      it('holds a thousand replies per event: the 1000th is stored, the next refused', async () => {
        await fill(MAX_RSVPS_PER_EVENT - 1)
        const last = await repo.admit(aRsvp({ eventId: 'evt-wedding', id: 'rsvp-last' }), NONE)
        expect(last.kind).toBe('added')

        const over = await repo.admit(aRsvp({ eventId: 'evt-wedding', id: 'rsvp-over' }), NONE)

        expect(over).toEqual({ kind: 'refused', refusal: 'tooMany' })
        expect(await repo.findById(WEDDING, asGuestRsvpId('rsvp-over'))).toBeNull()
        expect(await repo.listByEvent(WEDDING)).toHaveLength(MAX_RSVPS_PER_EVENT)
      })

      it('counts the thousand per event, and lets a full event still change a reply', async () => {
        await fill(MAX_RSVPS_PER_EVENT)

        const elsewhere = await repo.admit(aRsvp({ eventId: 'evt-gala', id: 'rsvp-x' }), NONE)
        const change = await repo.admit(
          aRsvp({ eventId: 'evt-wedding', id: 'rsvp-0', name: 'Changé' }),
          NONE,
        )

        expect(elsewhere.kind).toBe('added')
        expect(change.kind).toBe('updated')
      })

      it('refuses a "yes" that would pass the capacity, whole, and writes nothing', async () => {
        await add({ id: 'rsvp-1', adults: 8 })

        const outcome = await repo.admit(
          aRsvp({ eventId: 'evt-wedding', id: 'rsvp-2', adults: 3 }),
          { capacity: 10 },
        )

        expect(outcome).toEqual({ kind: 'refused', refusal: 'full' })
        expect(await repo.findById(WEDDING, asGuestRsvpId('rsvp-2'))).toBeNull()
      })

      it('accepts a "yes" that exactly fills the capacity', async () => {
        await add({ id: 'rsvp-1', adults: 8 })

        const outcome = await repo.admit(
          aRsvp({ eventId: 'evt-wedding', id: 'rsvp-2', adults: 2 }),
          { capacity: 10 },
        )

        expect(outcome.kind).toBe('added')
      })

      it('does not count the old value of a reply that is being changed', async () => {
        await add({ id: 'rsvp-1', adults: 8 })

        const outcome = await repo.admit(
          aRsvp({ eventId: 'evt-wedding', id: 'rsvp-1', adults: 10 }),
          { capacity: 10 },
        )

        expect(outcome.kind).toBe('updated')
      })

      it('counts a change from "no" to "yes" like a new "yes"', async () => {
        await add({ id: 'rsvp-1', adults: 9 })
        await add({ id: 'rsvp-2', answer: 'no' })

        const outcome = await repo.admit(
          aRsvp({ eventId: 'evt-wedding', id: 'rsvp-2', answer: 'yes', adults: 2 }),
          { capacity: 10 },
        )

        expect(outcome).toEqual({ kind: 'refused', refusal: 'full' })
        expect((await repo.findById(WEDDING, asGuestRsvpId('rsvp-2')))?.answer).toBe('no')
      })

      it('applies the capacity to "yes" only, and counts only the people who say yes', async () => {
        await add({ id: 'rsvp-1', adults: 10 })
        await add({ id: 'rsvp-2', answer: 'maybe', adults: 9 })

        const no = await repo.admit(aRsvp({ eventId: 'evt-wedding', id: 'rsvp-3', answer: 'no' }), {
          capacity: 10,
        })
        const maybe = await repo.admit(
          aRsvp({ eventId: 'evt-wedding', id: 'rsvp-4', answer: 'maybe', adults: 4 }),
          { capacity: 10 },
        )
        const other = await repo.admit(aRsvp({ eventId: 'evt-gala', id: 'rsvp-5', adults: 10 }), {
          capacity: 10,
        })

        expect([no.kind, maybe.kind, other.kind]).toEqual(['added', 'added', 'added'])
      })
    })

    describe('uniqueness', () => {
      it('refuses a second reply with the same token digest, in the same event or another', async () => {
        await add({ id: 'rsvp-1', editTokenHash: 'same' })

        await expect(
          repo.admit(aRsvp({ id: 'rsvp-2', eventId: 'evt-wedding', editTokenHash: 'same' }), NONE),
        ).rejects.toThrow(/UNIQUE/)
        await expect(
          repo.admit(aRsvp({ id: 'rsvp-3', eventId: 'evt-gala', editTokenHash: 'same' }), NONE),
        ).rejects.toThrow(/UNIQUE/)
        expect(await repo.listByEvent(WEDDING)).toHaveLength(1)
        expect(await repo.listByEvent(GALA)).toEqual([])
      })

      it('holds any number of replies without a token', async () => {
        await add({ id: 'rsvp-1', editTokenHash: null, source: 'host' })
        await add({ id: 'rsvp-2', editTokenHash: null, source: 'host' })

        expect(await repo.listByEvent(WEDDING)).toHaveLength(2)
      })

      it('refuses to move a reply to a household that already has one, and changes nothing', async () => {
        await add({ id: 'rsvp-1', householdId: 'h-1' })
        await add({ id: 'rsvp-2', householdId: null, name: 'Avant' })

        await expect(
          repo.update(
            aRsvp({ id: 'rsvp-2', eventId: 'evt-wedding', householdId: 'h-1', name: 'Après' }),
          ),
        ).rejects.toThrow(/UNIQUE/)

        const read = await repo.findById(WEDDING, asGuestRsvpId('rsvp-2'))
        expect(read?.householdId).toBeNull()
        expect(read?.name).toBe('Avant')
      })

      it('lets a reply keep its own household on update, and another event reuse the id', async () => {
        await add({ id: 'rsvp-1', householdId: 'h-1' })

        await repo.update(
          aRsvp({ id: 'rsvp-1', eventId: 'evt-wedding', householdId: 'h-1', name: 'Encore' }),
        )
        const other = await repo.admit(
          aRsvp({ id: 'rsvp-2', eventId: 'evt-gala', householdId: 'h-1' }),
          NONE,
        )

        expect((await repo.findById(WEDDING, asGuestRsvpId('rsvp-1')))?.name).toBe('Encore')
        expect(other.kind).toBe('added')
        expect((await repo.findByHousehold(WEDDING, 'h-1'))?.id).toBe('rsvp-1')
      })
    })

    describe('update, delete', () => {
      it('replaces the content and the household of a reply, and keeps its identity', async () => {
        await add({
          id: 'rsvp-1',
          editTokenHash: 'digest-1',
          source: 'open',
          householdId: null,
          createdAt: T0,
        })

        await repo.update(
          aRsvp({
            id: 'rsvp-1',
            eventId: 'evt-wedding',
            editTokenHash: 'ignored',
            source: 'host',
            householdId: 'h-9',
            name: 'Corrigé',
            answer: 'waitlist',
            adults: 2,
            createdAt: T2,
          }),
        )

        const read = await repo.findById(WEDDING, asGuestRsvpId('rsvp-1'))
        expect(read?.toProps()).toMatchObject({
          editTokenHash: 'digest-1',
          source: 'open',
          createdAt: T0,
          householdId: 'h-9',
          name: 'Corrigé',
          answer: 'waitlist',
          updatedAt: T2,
        })
      })

      it('says it changed a reply that was there', async () => {
        await add({ id: 'rsvp-1' })

        expect(await repo.update(aRsvp({ id: 'rsvp-1', eventId: 'evt-wedding' }))).toBe(true)
      })

      it('detaches a household, and is not held to any ceiling', async () => {
        await add({ id: 'rsvp-1', householdId: 'h-1', adults: 1 })

        await repo.update(
          aRsvp({ id: 'rsvp-1', eventId: 'evt-wedding', householdId: null, adults: 500 }),
        )

        const read = await repo.findById(WEDDING, asGuestRsvpId('rsvp-1'))
        expect(read?.householdId).toBeNull()
        expect(read?.adults).toBe(500)
      })

      it('does nothing for a reply that is not there, or that is another event’s', async () => {
        await repo.admit(aRsvp({ id: 'rsvp-1', eventId: 'evt-gala', name: 'Gala' }), NONE)

        const another = await repo.update(
          aRsvp({ id: 'rsvp-1', eventId: 'evt-wedding', name: 'Fantôme' }),
        )
        const missing = await repo.update(
          aRsvp({ id: 'rsvp-9', eventId: 'evt-wedding', name: 'Fantôme' }),
        )

        expect([another, missing]).toEqual([false, false])

        expect(await repo.listByEvent(WEDDING)).toEqual([])
        expect((await repo.findById(GALA, asGuestRsvpId('rsvp-1')))?.name).toBe('Gala')
      })

      it('deletes a reply and says so, once', async () => {
        await add({ id: 'rsvp-1', editTokenHash: 'digest-1' })

        expect(await repo.delete(WEDDING, asGuestRsvpId('rsvp-1'))).toBe(true)
        expect(await repo.delete(WEDDING, asGuestRsvpId('rsvp-1'))).toBe(false)
        expect(await repo.findByEditTokenHash(WEDDING, 'digest-1')).toBeNull()
      })

      it('never deletes the reply of another event', async () => {
        await repo.admit(aRsvp({ id: 'rsvp-1', eventId: 'evt-gala' }), NONE)

        expect(await repo.delete(WEDDING, asGuestRsvpId('rsvp-1'))).toBe(false)
        expect(await repo.findById(GALA, asGuestRsvpId('rsvp-1'))).not.toBeNull()
      })
    })

    describe('the narrow reads of the hot paths', () => {
      it('counts the replies of an event, and only its own', async () => {
        await add({ id: 'rsvp-1' })
        await add({ id: 'rsvp-2', answer: 'no' })
        await repo.admit(aRsvp({ id: 'rsvp-3', eventId: 'evt-gala' }), NONE)

        expect(await repo.count(WEDDING)).toBe(2)
        expect(await repo.count(GALA)).toBe(1)
        expect(await repo.count(asEventId('evt-nobody'))).toBe(0)
      })

      it('sums the people of the yes replies only: not a maybe, a no or a waiting list, not another event', async () => {
        await add({ id: 'rsvp-1', answer: 'yes', adults: 2, kids: 1 })
        await add({ id: 'rsvp-2', answer: 'yes', adults: 1 })
        await add({ id: 'rsvp-3', answer: 'maybe', adults: 5 })
        await add({ id: 'rsvp-4', answer: 'no' })
        await add({ id: 'rsvp-5', answer: 'waitlist', adults: 4 })
        await repo.admit(aRsvp({ id: 'rsvp-6', eventId: 'evt-gala', adults: 9 }), NONE)

        expect(await repo.yesPeople(WEDDING)).toBe(4)
        expect(await repo.yesPeople(asEventId('evt-nobody'))).toBe(0)
      })

      it('names, oldest first, the yes replies whose guest agreed to be shown, up to the limit', async () => {
        await add({ id: 'rsvp-c', name: 'Inès Lab', createdAt: T2, details: { showName: true } })
        await add({ id: 'rsvp-a', name: 'Léa Martin', createdAt: T0, details: { showName: true } })
        await add({ id: 'rsvp-b', name: 'Hugo Roux', createdAt: T1, details: { showName: false } })
        await add({
          id: 'rsvp-d',
          name: 'Tom Maybe',
          answer: 'maybe',
          createdAt: T0,
          details: { showName: true },
        })
        await add({ id: 'rsvp-e', name: 'Eve Egal', createdAt: T0, details: { showName: true } })
        await repo.admit(
          aRsvp({
            id: 'rsvp-f',
            eventId: 'evt-gala',
            name: 'Gala Gal',
            details: { showName: true },
          }),
          NONE,
        )

        expect(await repo.showNames(WEDDING, 10)).toEqual(['Léa Martin', 'Eve Egal', 'Inès Lab'])
        expect(await repo.showNames(WEDDING, 2)).toEqual(['Léa Martin', 'Eve Egal'])
        expect(await repo.showNames(WEDDING, 0)).toEqual([])
      })
    })

    describe('withdrawing the ticks', () => {
      it('clears every tick of the event in one write, leaving the rest and the other events alone', async () => {
        await add({
          id: 'rsvp-a',
          name: 'Léa Martin',
          updatedAt: T1,
          details: { showName: true, companions: ['Hugo'] },
        })
        await add({ id: 'rsvp-b', name: 'Hugo Roux', details: { showName: false } })
        await add({ id: 'rsvp-c', name: 'Tom Maybe', answer: 'maybe', details: { showName: true } })
        await repo.admit(
          aRsvp({
            id: 'rsvp-g',
            eventId: 'evt-gala',
            name: 'Gala Gal',
            details: { showName: true },
          }),
          NONE,
        )

        expect(await repo.clearShownNames(WEDDING)).toBe(2)

        expect(await repo.showNames(WEDDING, 10)).toEqual([])
        const kept = await repo.findById(WEDDING, asGuestRsvpId('rsvp-a'))
        expect(kept?.details).toMatchObject({ showName: false, companions: ['Hugo'] })
        expect(kept?.updatedAt).toEqual(T1)
        expect(await repo.showNames(asEventId('evt-gala'), 10)).toEqual(['Gala Gal'])
        expect(await repo.clearShownNames(WEDDING)).toBe(0)
      })
    })

    describe('what the host has not seen yet', () => {
      const HOST = asUserId('user-host')

      it('counts every reply for a member who never visited, and none for a stranger', async () => {
        await subject.addMember(WEDDING, HOST)
        await add({ id: 'rsvp-1' })
        await add({ id: 'rsvp-2' })

        expect(await repo.unseenCount(WEDDING, HOST)).toBe(2)
        expect(await repo.unseenCount(WEDDING, asUserId('user-stranger'))).toBe(0)
        expect(await repo.unseenCount(GALA, HOST)).toBe(0)
      })

      it('counts what was written or changed after the last visit, and not what the visit saw', async () => {
        await subject.addMember(WEDDING, HOST)
        await add({ id: 'rsvp-1', updatedAt: T0 })
        await add({ id: 'rsvp-2', updatedAt: T1 })
        await add({ id: 'rsvp-3', updatedAt: T2 })

        await repo.markSeen(WEDDING, HOST, T1)

        expect(await repo.unseenCount(WEDDING, HOST)).toBe(1)

        await repo.admit(
          aRsvp({
            id: 'rsvp-1',
            eventId: 'evt-wedding',
            name: 'Changé',
            updatedAt: new Date(T2.getTime() + 1),
          }),
          NONE,
        )
        expect(await repo.unseenCount(WEDDING, HOST)).toBe(2)

        await repo.markSeen(WEDDING, HOST, new Date(T2.getTime() + 1))
        expect(await repo.unseenCount(WEDDING, HOST)).toBe(0)
      })

      it('keeps the instant of each member and of each event apart', async () => {
        const other = asUserId('user-other')
        await subject.addMember(WEDDING, HOST)
        await subject.addMember(WEDDING, other)
        await subject.addMember(GALA, HOST)
        await add({ id: 'rsvp-1', updatedAt: T0 })
        await repo.admit(aRsvp({ id: 'rsvp-2', eventId: 'evt-gala', updatedAt: T0 }), NONE)

        await repo.markSeen(WEDDING, HOST, T2)

        expect(await repo.unseenCount(WEDDING, HOST)).toBe(0)
        expect(await repo.unseenCount(WEDDING, other)).toBe(1)
        expect(await repo.unseenCount(GALA, HOST)).toBe(1)
      })

      it('notes nothing for someone who is not a member', async () => {
        await add({ id: 'rsvp-1', updatedAt: T0 })

        await repo.markSeen(WEDDING, HOST, T2)
        await subject.addMember(WEDDING, HOST)

        expect(await repo.unseenCount(WEDDING, HOST)).toBe(1)
      })
    })

    describe('deleteExpired', () => {
      const CLOSED = new Date('2026-12-14T10:00:00.000Z')
      const day = (from: Date, days: number, extraMs = 0): Date =>
        new Date(from.getTime() + days * 86_400_000 + extraMs)

      it('keeps replies on day 29 after the close and erases them on day 30', async () => {
        await add({ id: 'rsvp-1' })
        await subject.setEventDates(WEDDING, { closedAt: CLOSED, startsAt: null })

        expect(await repo.deleteExpired(day(CLOSED, 30, -1))).toBe(0)
        expect(await repo.listByEvent(WEDDING)).toHaveLength(1)
        expect(await repo.deleteExpired(day(CLOSED, 30))).toBe(1)
        expect(await repo.listByEvent(WEDDING)).toEqual([])
      })

      it('erases an event that never closed 60 days after its invitation started', async () => {
        const starts = new Date('2026-12-13T18:00:00.000Z')
        await add({ id: 'rsvp-1' })
        await subject.setEventDates(WEDDING, { closedAt: null, startsAt: starts })

        expect(await repo.deleteExpired(day(starts, 60, -1))).toBe(0)
        expect(await repo.deleteExpired(day(starts, 60))).toBe(1)
      })

      it('erases at the earlier of the two dates', async () => {
        const starts = new Date('2026-12-13T18:00:00.000Z')
        await add({ id: 'rsvp-1' })
        await subject.setEventDates(WEDDING, { closedAt: CLOSED, startsAt: starts })

        expect(await repo.deleteExpired(day(CLOSED, 30))).toBe(1)
      })

      it('keeps what no date reaches, and touches only the events that expired', async () => {
        await add({ id: 'rsvp-1' })
        await repo.admit(aRsvp({ id: 'rsvp-2', eventId: 'evt-gala' }), NONE)
        await repo.admit(aRsvp({ id: 'rsvp-3', eventId: 'evt-gala' }), NONE)
        await subject.setEventDates(GALA, { closedAt: CLOSED, startsAt: null })

        expect(await repo.deleteExpired(day(CLOSED, 400))).toBe(2)

        expect((await repo.listByEvent(WEDDING)).map((rsvp) => rsvp.id)).toEqual(['rsvp-1'])
        expect(await repo.listByEvent(GALA)).toEqual([])
      })
    })
  })
}
