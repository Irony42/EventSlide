import { describe, expect, it } from 'vitest'
import type { HostAnnouncement } from '../../../domain/hostAnnouncements/hostAnnouncement'
import type { HostAnnouncementRepository } from '../../ports/hostAnnouncementRepository'

/** What the contract needs of a world: the repository, and the accounts it reads its recipients from. */
export interface HostAnnouncementSubject {
  readonly repo: HostAnnouncementRepository
  /** An account that owns a client. */
  addOwner(userId: string, email: string): Promise<void>
  /** An account that belongs to a client without owning it. */
  addMember(userId: string, email: string): Promise<void>
  /** An account that belongs to nothing. */
  addStranger(userId: string, email: string): Promise<void>
  /** Switches an account off. */
  switchOff(userId: string): Promise<void>
  /** An account that owns two clients. */
  ownAnotherClient(userId: string): Promise<void>
  dispose?(): Promise<void>
}

const AT = new Date('2026-11-27T10:00:00.000Z')
const day = (n: number): Date => new Date(AT.getTime() + n * 86_400_000)

const announcement = (id: string, patch: Partial<HostAnnouncement> = {}): HostAnnouncement => ({
  id,
  subject: `Sujet ${id}`,
  text: `Texte ${id}`,
  link: null,
  createdBy: null,
  createdAt: AT,
  finishedAt: null,
  ...patch,
})

/** The shared `HostAnnouncementRepository` contract, run against the fake and the SQLite adapter. */
export const hostAnnouncementRepositoryContract = (
  name: string,
  makeSubject: () => Promise<HostAnnouncementSubject>,
): void => {
  describe(`HostAnnouncementRepository contract: ${name}`, () => {
    const withWorld = async (
      body: (world: HostAnnouncementSubject) => Promise<void>,
    ): Promise<void> => {
      const world = await makeSubject()
      try {
        await body(world)
      } finally {
        await world.dispose?.()
      }
    }

    it('keeps what was written, newest first, with nobody reached yet', () =>
      withWorld(async ({ repo }) => {
        await repo.create(announcement('a-old', { createdAt: AT }))
        await repo.create(
          announcement('a-new', { createdAt: day(1), link: 'https://eventslide.fr/cgu' }),
        )

        const listed = await repo.listRecent(10)

        expect(listed.map((row) => row.announcement.id)).toEqual(['a-new', 'a-old'])
        expect(listed[0]?.announcement).toEqual(
          announcement('a-new', { createdAt: day(1), link: 'https://eventslide.fr/cgu' }),
        )
        expect(listed.map((row) => row.delivered)).toEqual([0, 0])
        expect((await repo.listRecent(1)).map((row) => row.announcement.id)).toEqual(['a-new'])
      }))

    it('reads as recipients the active owners of at least one client, once each, and nobody else', () =>
      withWorld(async (world) => {
        await world.addOwner('u-b', 'b@example.test')
        await world.addOwner('u-a', 'a@example.test')
        await world.ownAnotherClient('u-a')
        await world.addMember('u-member', 'member@example.test')
        await world.addStranger('u-stranger', 'stranger@example.test')
        await world.addOwner('u-off', 'off@example.test')
        await world.switchOff('u-off')
        await world.repo.create(announcement('a-one'))

        expect(await world.repo.countRecipients()).toBe(2)
        expect(await world.repo.pendingRecipients('a-one', 10)).toEqual([
          { userId: 'u-a', email: 'a@example.test' },
          { userId: 'u-b', email: 'b@example.test' },
        ])
        expect(await world.repo.pendingRecipients('a-one', 1)).toEqual([
          { userId: 'u-a', email: 'a@example.test' },
        ])
      }))

    it('notes a delivery for one caller only, and leaves the recipient out of what is still owed', () =>
      withWorld(async (world) => {
        await world.addOwner('u-a', 'a@example.test')
        await world.addOwner('u-b', 'b@example.test')
        await world.repo.create(announcement('a-one'))

        expect(await world.repo.recordDelivery('a-one', 'u-a', AT)).toBe(true)
        expect(await world.repo.recordDelivery('a-one', 'u-a', AT)).toBe(false)

        expect(await world.repo.pendingRecipients('a-one', 10)).toEqual([
          { userId: 'u-b', email: 'b@example.test' },
        ])
        expect((await world.repo.listRecent(1))[0]?.delivered).toBe(1)
      }))

    it('owes the same account a second announcement: a delivery is per announcement', () =>
      withWorld(async (world) => {
        await world.addOwner('u-a', 'a@example.test')
        await world.repo.create(announcement('a-one'))
        await world.repo.create(announcement('a-two'))
        await world.repo.recordDelivery('a-one', 'u-a', AT)

        expect(await world.repo.pendingRecipients('a-two', 10)).toHaveLength(1)
        expect(await world.repo.recordDelivery('a-two', 'u-a', AT)).toBe(true)
      }))

    it('does not note a delivery for an announcement that is not there', () =>
      withWorld(async (world) => {
        await world.addOwner('u-a', 'a@example.test')

        expect(await world.repo.recordDelivery('nobody', 'u-a', AT)).toBe(false)
      }))

    it('stops owing an account that was switched off after the announcement began', () =>
      withWorld(async (world) => {
        await world.addOwner('u-a', 'a@example.test')
        await world.repo.create(announcement('a-one'))
        await world.switchOff('u-a')

        expect(await world.repo.pendingRecipients('a-one', 10)).toEqual([])
      }))

    it('lists the unfinished announcements, oldest first, and keeps the first instant a finish was given', () =>
      withWorld(async ({ repo }) => {
        await repo.create(announcement('a-late', { createdAt: day(2) }))
        await repo.create(announcement('a-early', { createdAt: day(1) }))
        await repo.create(announcement('a-done', { createdAt: day(3) }))

        await repo.finish('a-done', day(4))
        await repo.finish('a-done', day(9))

        expect((await repo.unfinished()).map((row) => row.id)).toEqual(['a-early', 'a-late'])
        const done = (await repo.listRecent(10)).find((row) => row.announcement.id === 'a-done')
        expect(done?.announcement.finishedAt).toEqual(day(4))
      }))

    it('erases the deliveries of announcements finished before the cutoff, and only those', () =>
      withWorld(async (world) => {
        await world.addOwner('u-a', 'a@example.test')
        await world.repo.create(announcement('a-old'))
        await world.repo.create(announcement('a-recent'))
        await world.repo.create(announcement('a-going'))
        for (const id of ['a-old', 'a-recent', 'a-going']) {
          await world.repo.recordDelivery(id, 'u-a', AT)
        }
        await world.repo.finish('a-old', day(1))
        await world.repo.finish('a-recent', day(20))

        expect(await world.repo.deleteDeliveriesFinishedBefore(day(10))).toBe(1)

        const delivered = Object.fromEntries(
          (await world.repo.listRecent(10)).map((row) => [row.announcement.id, row.delivered]),
        )
        expect(delivered).toEqual({ 'a-old': 0, 'a-recent': 1, 'a-going': 1 })
        // The announcement itself stays, and an erased delivery does not make it owed again: it is finished.
        expect((await world.repo.unfinished()).map((row) => row.id)).toEqual(['a-going'])
      }))

    it('erases the announcements written before the cutoff, with their deliveries', () =>
      withWorld(async (world) => {
        await world.addOwner('u-a', 'a@example.test')
        await world.repo.create(announcement('a-old', { createdAt: day(0) }))
        await world.repo.create(announcement('a-new', { createdAt: day(400) }))
        await world.repo.recordDelivery('a-old', 'u-a', AT)

        expect(await world.repo.deleteCreatedBefore(day(366))).toBe(1)

        expect((await world.repo.listRecent(10)).map((row) => row.announcement.id)).toEqual([
          'a-new',
        ])
        expect(await world.repo.recordDelivery('a-old', 'u-a', AT)).toBe(false)
      }))
  })
}
