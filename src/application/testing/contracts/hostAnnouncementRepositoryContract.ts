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

    it('reads one recipient per address, the lowest id when two accounts differ only by case, and none once the address was reached', () =>
      withWorld(async (world) => {
        await world.addOwner('u-b', 'Hote@Example.test')
        await world.addOwner('u-a', 'hote@example.test')
        await world.addOwner('u-c', 'autre@example.test')
        await world.repo.create(announcement('a-one'))

        expect(await world.repo.countRecipients()).toBe(2)
        expect(await world.repo.pendingRecipients('a-one', 10)).toEqual([
          { userId: 'u-a', email: 'hote@example.test' },
          { userId: 'u-c', email: 'autre@example.test' },
        ])

        // A delivery under the other account of the same address reaches the address.
        expect(await world.repo.recordDelivery('a-one', 'u-b', AT)).toBe(true)
        expect(await world.repo.pendingRecipients('a-one', 10)).toEqual([
          { userId: 'u-c', email: 'autre@example.test' },
        ])
      }))

    it('takes a delivery back, so that the account is owed again and may be noted once more', () =>
      withWorld(async (world) => {
        await world.addOwner('u-a', 'a@example.test')
        await world.repo.create(announcement('a-one'))
        await world.repo.recordDelivery('a-one', 'u-a', AT)

        await world.repo.forgetDelivery('a-one', 'u-a')
        await world.repo.forgetDelivery('a-one', 'u-nobody')

        expect((await world.repo.listRecent(1))[0]?.delivered).toBe(0)
        expect(await world.repo.pendingRecipients('a-one', 10)).toHaveLength(1)
        expect(await world.repo.recordDelivery('a-one', 'u-a', AT)).toBe(true)
      }))

    it('says how many accounts an announcement is owed to in all while it goes out, and how many it reached once it finished', () =>
      withWorld(async (world) => {
        await world.addOwner('u-a', 'a@example.test')
        await world.addOwner('u-b', 'b@example.test')
        await world.addOwner('u-c', 'c@example.test')
        await world.repo.create(announcement('a-one'))
        await world.repo.recordDelivery('a-one', 'u-a', AT)

        expect((await world.repo.listRecent(1))[0]).toMatchObject({ delivered: 1, owed: 3 })

        await world.repo.recordDelivery('a-one', 'u-b', AT)
        await world.repo.recordDelivery('a-one', 'u-c', AT)
        await world.repo.finish('a-one', day(1))
        await world.addOwner('u-d', 'd@example.test')

        expect((await world.repo.listRecent(1))[0]).toMatchObject({ delivered: 3, owed: 3 })
      }))

    it('knows an announcement of the same words written recently or still going out, and no other', () =>
      withWorld(async ({ repo }) => {
        const words = { subject: 'Sujet', text: 'Texte', link: null }
        await repo.create(announcement('a-one', { ...words, createdAt: AT }))
        const tenMinutesLater = new Date(AT.getTime() + 600_000)
        const anHourLater = new Date(AT.getTime() + 3_600_000)

        // Still going out: a duplicate whatever its age.
        expect(await repo.existsDuplicate(words, anHourLater)).toBe(true)
        await repo.finish('a-one', AT)
        // Finished: only a recent one is.
        expect(await repo.existsDuplicate(words, AT)).toBe(true)
        expect(await repo.existsDuplicate(words, tenMinutesLater)).toBe(false)
        // Other words are not.
        expect(await repo.existsDuplicate({ ...words, subject: 'Autre' }, AT)).toBe(false)
        expect(await repo.existsDuplicate({ ...words, text: 'Autre' }, AT)).toBe(false)
        expect(await repo.existsDuplicate({ ...words, link: 'https://eventslide.fr/a' }, AT)).toBe(
          false,
        )
      }))

    it('tells an announcement with a link from the same words with another', () =>
      withWorld(async ({ repo }) => {
        const words = { subject: 'Sujet', text: 'Texte', link: 'https://eventslide.fr/a' }
        await repo.create(announcement('a-one', words))

        expect(await repo.existsDuplicate(words, AT)).toBe(true)
        expect(await repo.existsDuplicate({ ...words, link: 'https://eventslide.fr/b' }, AT)).toBe(
          false,
        )
        expect(await repo.existsDuplicate({ ...words, link: null }, AT)).toBe(false)
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
