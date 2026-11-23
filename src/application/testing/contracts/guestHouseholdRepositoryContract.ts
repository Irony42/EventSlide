import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_HOUSEHOLDS_PER_EVENT } from '../../../domain/guestRsvps/household'
import { HouseholdToken } from '../../../domain/guestRsvps/householdToken'
import { aHousehold } from '../../../domain/guestRsvps/testing/householdFixtures'
import { asEventId, asGuestHouseholdId, type EventId } from '../../../domain/shared/ids'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'

/**
 * The behaviour every `GuestHouseholdRepository` must have, run against the fake **and** SQLite:
 * every lookup scoped by the event (a token included), an all-or-none insertion that decides its
 * ceiling in one step, a change that never moves the token or the note, and the expiry of
 * households by their event's dates, the replies' own rule.
 */

/** Rows the SQLite harness must create before the contract runs; the fake ignores them. */
export const GUEST_HOUSEHOLD_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  userIds: ['user-host'],
} as const

export interface GuestHouseholdRepositorySubject {
  readonly repo: GuestHouseholdRepository
  /** Sets what the event's `closed_at` and its invitation's start say, for the expiry. */
  readonly setEventDates: (
    eventId: EventId,
    dates: { readonly closedAt: Date | null; readonly startsAt: Date | null },
  ) => Promise<void>
  /** A reply filed under a household, as `guest_rsvps` holds it (the other port's rows, here only to be detached). */
  readonly seedReply: (eventId: EventId, id: string, householdId: string) => Promise<void>
  /** What `household_id` of that reply says now, or `undefined` for a reply that does not exist. */
  readonly replyHousehold: (eventId: EventId, id: string) => Promise<string | null | undefined>
  readonly dispose?: () => Promise<void>
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const T0 = new Date('2026-11-23T10:00:00.000Z')
const T1 = new Date('2026-11-23T11:00:00.000Z')
const CLOSED = new Date('2026-12-01T00:00:00.000Z')
const day = (from: Date, days: number, offsetMs = 0): Date =>
  new Date(from.getTime() + days * 86_400_000 + offsetMs)

/** A token that is the nth of a series, distinct from every other. */
const tokenOf = (n: number): string => `TOKEN${String(n).padStart(11, '0')}`

const token = (raw: string): HouseholdToken => {
  const made = HouseholdToken.create(raw)
  if (!made.ok) throw new Error('bad token')
  return made.value
}

export const guestHouseholdRepositoryContract = (
  name: string,
  makeSubject: () => Promise<GuestHouseholdRepositorySubject>,
): void => {
  describe(`GuestHouseholdRepository contract: ${name}`, () => {
    let subject: GuestHouseholdRepositorySubject
    let repo: GuestHouseholdRepository

    beforeEach(async () => {
      if (subject?.dispose !== undefined) await subject.dispose()
      subject = await makeSubject()
      repo = subject.repo
    })

    const add = async (overrides: Parameters<typeof aHousehold>[0] = {}) => {
      const household = aHousehold({ eventId: 'evt-wedding', ...overrides })
      if (!(await repo.addAll(household.eventId, [household]))) throw new Error('not added')
      return household
    }

    describe('reading', () => {
      it('has no household until one is added', async () => {
        expect(await repo.listByEvent(WEDDING)).toEqual([])
        expect(await repo.count(WEDDING)).toBe(0)
        expect(await repo.findById(WEDDING, asGuestHouseholdId('household-1'))).toBeNull()
        expect(await repo.findByToken(WEDDING, token('7QX0M4TZ2KD9WB3H'))).toBeNull()
      })

      it('finds a household by id and by token, with everything it was stored with', async () => {
        const stored = await add({ id: 'h-1', name: 'Les Durand', places: 2, createdAt: T0 })

        const byId = await repo.findById(WEDDING, asGuestHouseholdId('h-1'))
        const byToken = await repo.findByToken(WEDDING, stored.token)

        expect(byId?.toProps()).toEqual(stored.toProps())
        expect(byToken?.toProps()).toEqual(stored.toProps())
        expect(byToken?.token.value).toBe('7QX0M4TZ2KD9WB3H')
      })

      it('lists the households of an event in the order they were added, a paste’s lines too', async () => {
        const batch = ['c', 'a', 'b'].map((id, i) =>
          aHousehold({ id, eventId: 'evt-wedding', token: tokenOf(i), name: id, createdAt: T1 }),
        )
        await add({ id: 'first', token: tokenOf(9), createdAt: T0 })
        await repo.addAll(WEDDING, batch)
        await repo.addAll(GALA, [
          aHousehold({ id: 'elsewhere', eventId: 'evt-gala', token: tokenOf(10) }),
        ])

        expect((await repo.listByEvent(WEDDING)).map((household) => household.id)).toEqual([
          'first',
          'c',
          'a',
          'b',
        ])
        expect(await repo.count(WEDDING)).toBe(4)
        expect(await repo.count(GALA)).toBe(1)
      })
    })

    describe('scoping by the event', () => {
      it('finds nothing in another event: not by id, not by token', async () => {
        const stored = await add({ id: 'h-1' })

        expect(await repo.findById(GALA, asGuestHouseholdId('h-1'))).toBeNull()
        expect(await repo.findByToken(GALA, stored.token)).toBeNull()
      })

      it('changes, renews, notes and deletes nothing in another event', async () => {
        await add({ id: 'h-1' })
        const other = aHousehold({ id: 'h-1', eventId: 'evt-gala', name: 'Intrus' })

        expect(await repo.update(other)).toBe(false)
        expect(
          await repo.rotateToken(GALA, asGuestHouseholdId('h-1'), token('00000000000000AA'), T1),
        ).toBe(false)
        expect(await repo.markReminded(GALA, asGuestHouseholdId('h-1'), T1)).toBe(false)
        expect(await repo.delete(GALA, asGuestHouseholdId('h-1'))).toBe(false)

        const kept = await repo.findById(WEDDING, asGuestHouseholdId('h-1'))
        expect(kept?.name).toBe('Famille Martin')
        expect(kept?.token.value).toBe('7QX0M4TZ2KD9WB3H')
        expect(kept?.remindedAt).toBeNull()
      })
    })

    describe('addAll', () => {
      it('stores several at once, in order', async () => {
        const batch = [1, 2, 3].map((n) =>
          aHousehold({ id: `h-${n}`, eventId: 'evt-wedding', token: tokenOf(n), name: `F${n}` }),
        )

        expect(await repo.addAll(WEDDING, batch)).toBe(true)

        expect((await repo.listByEvent(WEDDING)).map((household) => household.name)).toEqual([
          'F1',
          'F2',
          'F3',
        ])
      })

      it('refuses, and writes nothing, past the ceiling of 500 an event may hold', async () => {
        const make = (from: number, count: number) =>
          Array.from({ length: count }, (_, i) =>
            aHousehold({
              id: `h-${from + i}`,
              eventId: 'evt-wedding',
              token: tokenOf(from + i),
              name: `F${from + i}`,
            }),
          )
        expect(await repo.addAll(WEDDING, make(0, MAX_HOUSEHOLDS_PER_EVENT - 1))).toBe(true)

        expect(await repo.addAll(WEDDING, make(1000, 2))).toBe(false)
        expect(await repo.count(WEDDING)).toBe(MAX_HOUSEHOLDS_PER_EVENT - 1)

        expect(await repo.addAll(WEDDING, make(2000, 1))).toBe(true)
        expect(await repo.addAll(WEDDING, make(3000, 1))).toBe(false)
        // The ceiling is the event's own: another event is not held back by it.
        expect(
          await repo.addAll(GALA, [
            aHousehold({ id: 'g', eventId: 'evt-gala', token: tokenOf(5000) }),
          ]),
        ).toBe(true)
      })

      it('takes the whole paste back when one token is already held, even by another event', async () => {
        await repo.addAll(GALA, [
          aHousehold({ id: 'g-1', eventId: 'evt-gala', token: '7QX0M4TZ2KD9WB3H' }),
        ])
        const batch = [
          aHousehold({ id: 'h-1', eventId: 'evt-wedding', token: tokenOf(1) }),
          aHousehold({ id: 'h-2', eventId: 'evt-wedding', token: '7QX0M4TZ2KD9WB3H' }),
        ]

        await expect(repo.addAll(WEDDING, batch)).rejects.toThrow(/UNIQUE/)

        expect(await repo.count(WEDDING)).toBe(0)
      })
    })

    describe('update, rotateToken, markReminded, delete', () => {
      it('replaces the name and places and updatedAt, and keeps the token, the note and the creation', async () => {
        const stored = await add({ id: 'h-1', createdAt: T0 })
        await repo.markReminded(WEDDING, asGuestHouseholdId('h-1'), T0)

        const changed = stored.withInput({ name: 'Les Martin', places: 2 }, T1)
        expect(await repo.update(changed)).toBe(true)

        const read = await repo.findById(WEDDING, asGuestHouseholdId('h-1'))
        expect(read?.name).toBe('Les Martin')
        expect(read?.places).toBe(2)
        expect(read?.updatedAt).toEqual(T1)
        expect(read?.token.value).toBe('7QX0M4TZ2KD9WB3H')
        expect(read?.remindedAt).toEqual(T0)
        expect(read?.createdAt).toEqual(T0)
      })

      it('stores the moments a household is invited to, and null for all of them', async () => {
        const stored = await add({ id: 'h-1', createdAt: T0 })
        expect((await repo.findById(WEDDING, asGuestHouseholdId('h-1')))?.moments).toBeNull()

        const input = { name: stored.name, places: stored.places }
        await repo.update(stored.withInput(input, T1, ['aaaaaaaa', 'bbbbbbbb']))
        const invited = await repo.findById(WEDDING, asGuestHouseholdId('h-1'))
        expect(invited?.moments).toEqual(['aaaaaaaa', 'bbbbbbbb'])

        await repo.update(invited!.withInput(input, T1, null))
        expect((await repo.findById(WEDDING, asGuestHouseholdId('h-1')))?.moments).toBeNull()
      })

      it('stores the moments of a household added with them', async () => {
        await add({ id: 'h-2', moments: ['cccccccc'], token: tokenOf(2) })

        expect((await repo.findById(WEDDING, asGuestHouseholdId('h-2')))?.moments).toEqual([
          'cccccccc',
        ])
      })

      it('says false for a household that is gone', async () => {
        expect(await repo.update(aHousehold({ eventId: 'evt-wedding' }))).toBe(false)
        expect(
          await repo.rotateToken(
            WEDDING,
            asGuestHouseholdId('nope'),
            token('00000000000000AA'),
            T1,
          ),
        ).toBe(false)
        expect(await repo.markReminded(WEDDING, asGuestHouseholdId('nope'), T1)).toBe(false)
        expect(await repo.delete(WEDDING, asGuestHouseholdId('nope'))).toBe(false)
      })

      it('replaces the token, and the old one finds nothing at once', async () => {
        const stored = await add({ id: 'h-1', createdAt: T0 })

        expect(
          await repo.rotateToken(WEDDING, asGuestHouseholdId('h-1'), token('00000000000000AA'), T1),
        ).toBe(true)

        expect(await repo.findByToken(WEDDING, stored.token)).toBeNull()
        const renewed = await repo.findByToken(WEDDING, token('00000000000000AA'))
        expect(renewed?.id).toBe('h-1')
        expect(renewed?.updatedAt).toEqual(T1)
        expect(renewed?.name).toBe('Famille Martin')
      })

      it('refuses a new token another household holds', async () => {
        await add({ id: 'h-1' })
        await add({ id: 'h-2', token: tokenOf(2) })

        await expect(
          repo.rotateToken(WEDDING, asGuestHouseholdId('h-2'), token('7QX0M4TZ2KD9WB3H'), T1),
        ).rejects.toThrow(/UNIQUE/)
      })

      it('notes the reminder and moves updatedAt with it', async () => {
        await add({ id: 'h-1', createdAt: T0 })

        expect(await repo.markReminded(WEDDING, asGuestHouseholdId('h-1'), T1)).toBe(true)

        const read = await repo.findById(WEDDING, asGuestHouseholdId('h-1'))
        expect(read?.remindedAt).toEqual(T1)
        expect(read?.updatedAt).toEqual(T1)
      })

      it('detaches the reply filed under the deleted household, keeps it, and touches no other event’s', async () => {
        await add({ id: 'h-1' })
        await repo.addAll(GALA, [
          aHousehold({ id: 'g-1', eventId: 'evt-gala', token: tokenOf(77) }),
        ])
        await subject.seedReply(WEDDING, 'r-1', 'h-1')
        await subject.seedReply(GALA, 'r-2', 'h-1')

        expect(await repo.delete(WEDDING, asGuestHouseholdId('h-1'))).toBe(true)

        expect(await subject.replyHousehold(WEDDING, 'r-1')).toBeNull()
        expect(await subject.replyHousehold(GALA, 'r-2')).toBe('h-1')
      })

      it('leaves a reply alone when the household to delete is not the event’s', async () => {
        await add({ id: 'h-1' })
        await subject.seedReply(WEDDING, 'r-1', 'h-1')

        expect(await repo.delete(GALA, asGuestHouseholdId('h-1'))).toBe(false)

        expect(await subject.replyHousehold(WEDDING, 'r-1')).toBe('h-1')
      })

      it('deletes a household, once', async () => {
        await add({ id: 'h-1' })

        expect(await repo.delete(WEDDING, asGuestHouseholdId('h-1'))).toBe(true)
        expect(await repo.delete(WEDDING, asGuestHouseholdId('h-1'))).toBe(false)
        expect(await repo.listByEvent(WEDDING)).toEqual([])
      })
    })

    describe('deleteExpired', () => {
      it('erases at 30 days after the event closed, not before', async () => {
        await add({ id: 'h-1' })
        await subject.setEventDates(WEDDING, { closedAt: CLOSED, startsAt: null })

        expect(await repo.deleteExpired(day(CLOSED, 30, -1))).toBe(0)
        expect(await repo.deleteExpired(day(CLOSED, 30))).toBe(1)
        expect(await repo.listByEvent(WEDDING)).toEqual([])
      })

      it('erases at 60 days after the invitation’s start when the event never closed', async () => {
        const starts = new Date('2026-12-13T18:00:00.000Z')
        await add({ id: 'h-1' })
        await subject.setEventDates(WEDDING, { closedAt: null, startsAt: starts })

        expect(await repo.deleteExpired(day(starts, 60, -1))).toBe(0)
        expect(await repo.deleteExpired(day(starts, 60))).toBe(1)
      })

      it('keeps what no date reaches, and touches only the events that expired', async () => {
        await add({ id: 'h-1' })
        await repo.addAll(GALA, [
          aHousehold({ id: 'g-1', eventId: 'evt-gala', token: tokenOf(1) }),
          aHousehold({ id: 'g-2', eventId: 'evt-gala', token: tokenOf(2) }),
        ])
        await subject.setEventDates(GALA, { closedAt: CLOSED, startsAt: null })

        expect(await repo.deleteExpired(day(CLOSED, 400))).toBe(2)

        expect((await repo.listByEvent(WEDDING)).map((household) => household.id)).toEqual(['h-1'])
        expect(await repo.listByEvent(GALA)).toEqual([])
      })
    })
  })
}
