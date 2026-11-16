import { beforeEach, describe, expect, it } from 'vitest'
import { Announcement } from '../../../domain/announcements/announcement'
import type { AnnouncementKind } from '../../../domain/announcements/announcementRules'
import { MAX_ANNOUNCEMENTS_PER_EVENT } from '../../../domain/announcements/announcementRules'
import { asAnnouncementId, asEventId, asUserId } from '../../../domain/shared/ids'
import type { AnnouncementRepository } from '../../ports/announcementRepository'
import { anAnnouncement, AT, atPlus } from '../builders'

/**
 * The behaviour every `AnnouncementRepository` must have, run against the fake **and** SQLite.
 *
 * What it pins is the two rules no index can hold, the ceiling and "two of a kind never
 * overlap", and the scoping by event: a fake that let two cards overlap, or answered another
 * evening's id, would make every ring-2 test about announcements prove the opposite of what
 * production does.
 */

/** Rows the SQLite harness must create before the contract runs; the fake ignores them. */
export const ANNOUNCEMENT_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  userIds: ['user-host'],
} as const

export interface AnnouncementRepositorySubject {
  readonly repo: AnnouncementRepository
  readonly dispose?: () => Promise<void>
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const SECOND = 1000
const MINUTE = 60 * SECOND

const cardAt = (
  input: {
    readonly id?: string
    readonly eventId?: string
    readonly kind?: AnnouncementKind
    readonly offsetMs?: number
    readonly seconds?: number
    readonly countdown?: number
    readonly text?: string
  } = {},
): Announcement =>
  anAnnouncement({
    id: input.id ?? 'a1',
    eventId: input.eventId ?? 'evt-wedding',
    kind: input.kind ?? 'fullscreen',
    at: atPlus(input.offsetMs ?? 0),
    durationSeconds: input.seconds ?? (input.kind === 'discreet' ? 300 : 30),
    countdownSeconds: input.countdown ?? 0,
    text: input.text ?? 'Gâteau',
    createdBy: 'user-host',
  })

export const announcementRepositoryContract = (
  name: string,
  makeSubject: () => Promise<AnnouncementRepositorySubject>,
): void => {
  describe(`AnnouncementRepository contract: ${name}`, () => {
    let subject: AnnouncementRepositorySubject
    let repo: AnnouncementRepository

    beforeEach(async () => {
      if (subject?.dispose !== undefined) await subject.dispose()
      subject = await makeSubject()
      repo = subject.repo
    })

    const create = (announcement: Announcement) =>
      repo.tryCreate(announcement, MAX_ANNOUNCEMENTS_PER_EVENT)

    // -------------------------------------------------------------------- create --

    it('creates an announcement and reads it back whole', async () => {
      const announcement = cardAt({ countdown: 300, seconds: 60 })

      expect(await create(announcement)).toBe('created')

      const read = await repo.findById(WEDDING, asAnnouncementId('a1'))
      expect(read?.toProps()).toEqual(announcement.toProps())
    })

    it('keeps the moment to the millisecond', async () => {
      const exact = anAnnouncement({
        id: 'a1',
        eventId: 'evt-wedding',
        at: new Date(AT.getTime() + 7),
      })

      await create(exact)

      expect((await repo.findById(WEDDING, exact.id))?.at.getTime()).toBe(AT.getTime() + 7)
    })

    it('keeps a host-less row, whose author is gone', async () => {
      const orphan = anAnnouncement({ id: 'a1', eventId: 'evt-wedding', createdBy: null })

      await create(orphan)

      expect((await repo.findById(WEDDING, orphan.id))?.toProps().createdBy).toBeNull()
    })

    it('refuses the fifty-first announcement of an event', async () => {
      for (let i = 0; i < MAX_ANNOUNCEMENTS_PER_EVENT; i += 1) {
        expect(await create(cardAt({ id: `a${i}`, offsetMs: i * MINUTE }))).toBe('created')
      }

      expect(
        await create(cardAt({ id: 'a-last', offsetMs: MAX_ANNOUNCEMENTS_PER_EVENT * MINUTE })),
      ).toBe('limitReached')
      expect(await repo.listByEvent(WEDDING)).toHaveLength(MAX_ANNOUNCEMENTS_PER_EVENT)
    })

    it('counts every row toward the ceiling, the past ones too', async () => {
      await create(cardAt({ id: 'old', offsetMs: -3600 * SECOND }))

      expect(await repo.tryCreate(cardAt({ id: 'a1' }), 1)).toBe('limitReached')
    })

    it('does not count another event toward the ceiling', async () => {
      await create(cardAt({ id: 'a-gala', eventId: 'evt-gala' }))

      expect(await repo.tryCreate(cardAt({ id: 'a1' }), 1)).toBe('created')
    })

    // ------------------------------------------------------------------- overlap --

    it('refuses a fullscreen card that starts before the previous one ends', async () => {
      await create(cardAt({ id: 'a1', seconds: 30 }))

      expect(await create(cardAt({ id: 'a2', offsetMs: 29 * SECOND }))).toBe('overlap')
      expect(await repo.listByEvent(WEDDING)).toHaveLength(1)
    })

    it('accepts a fullscreen card that starts as the previous one ends', async () => {
      await create(cardAt({ id: 'a1', seconds: 30 }))

      expect(await create(cardAt({ id: 'a2', offsetMs: 30 * SECOND }))).toBe('created')
    })

    it('refuses a fullscreen card that starts before the one after it, too', async () => {
      await create(cardAt({ id: 'a1', offsetMs: 10 * SECOND }))

      expect(await create(cardAt({ id: 'a2', offsetMs: 0, seconds: 11 }))).toBe('overlap')
    })

    it('refuses two discreet announcements 59 seconds apart and accepts them 60 apart', async () => {
      await create(cardAt({ id: 'd1', kind: 'discreet', seconds: 300 }))

      expect(
        await create(cardAt({ id: 'd2', kind: 'discreet', offsetMs: 300 * SECOND + 59 * SECOND })),
      ).toBe('overlap')
      expect(
        await create(cardAt({ id: 'd3', kind: 'discreet', offsetMs: 300 * SECOND + 60 * SECOND })),
      ).toBe('created')
    })

    it('lets a fullscreen card and a discreet announcement overlap: two layers', async () => {
      await create(cardAt({ id: 'd1', kind: 'discreet', seconds: 900 }))

      expect(await create(cardAt({ id: 'c1', offsetMs: 60 * SECOND }))).toBe('created')
    })

    it('does not look at another event for an overlap', async () => {
      await create(cardAt({ id: 'a-gala', eventId: 'evt-gala' }))

      expect(await create(cardAt({ id: 'a1' }))).toBe('created')
    })

    // ---------------------------------------------------------------------- save --

    it('saves the changed fields of an existing announcement', async () => {
      await create(cardAt({ id: 'a1' }))
      const changed = anAnnouncement({
        id: 'a1',
        eventId: 'evt-wedding',
        text: 'Discours',
        kind: 'discreet',
        at: atPlus(120 * SECOND),
        durationSeconds: 600,
        countdownSeconds: 0,
        createdBy: 'user-host',
      })

      expect(await repo.trySave(changed)).toBe('saved')

      const read = await repo.findById(WEDDING, asAnnouncementId('a1'))
      expect(read?.text.value).toBe('Discours')
      expect(read?.kind).toBe('discreet')
      expect(read?.at.getTime()).toBe(AT.getTime() + 120 * SECOND)
      expect(read?.durationSeconds).toBe(600)
    })

    it('does not rewrite who created it, nor when', async () => {
      const original = cardAt({ id: 'a1' })
      await create(original)

      await repo.trySave(
        Announcement.restore({
          ...cardAt({ id: 'a1', text: 'Autre' }).toProps(),
          createdBy: asUserId('someone-else'),
          createdAt: atPlus(5 * MINUTE),
        }),
      )

      const read = (await repo.findById(WEDDING, asAnnouncementId('a1')))?.toProps()
      expect(read?.createdBy).toBe(original.toProps().createdBy)
      expect(read?.createdAt).toEqual(original.toProps().createdAt)
    })

    it('saves an announcement over its own span: it does not overlap itself', async () => {
      await create(cardAt({ id: 'a1', seconds: 30 }))

      expect(await repo.trySave(cardAt({ id: 'a1', seconds: 60, text: 'Plus long' }))).toBe('saved')
    })

    it('refuses a save that would overlap another announcement of the kind', async () => {
      await create(cardAt({ id: 'a1', offsetMs: 0, seconds: 30 }))
      await create(cardAt({ id: 'a2', offsetMs: 60 * SECOND }))

      expect(await repo.trySave(cardAt({ id: 'a2', offsetMs: 10 * SECOND }))).toBe('overlap')
      expect((await repo.findById(WEDDING, asAnnouncementId('a2')))?.at.getTime()).toBe(
        AT.getTime() + 60 * SECOND,
      )
    })

    it('answers notFound for an announcement that is not there', async () => {
      expect(await repo.trySave(cardAt({ id: 'ghost' }))).toBe('notFound')
    })

    it('never saves over another event row, even with its id', async () => {
      await create(cardAt({ id: 'a1', text: 'Gâteau' }))

      const outcome = await repo.trySave(cardAt({ id: 'a1', eventId: 'evt-gala', text: 'Pirate' }))

      expect(outcome).toBe('notFound')
      expect((await repo.findById(WEDDING, asAnnouncementId('a1')))?.text.value).toBe('Gâteau')
    })

    // ----------------------------------------------------------------- isolation --

    it('never reads another event announcement, by list or by id', async () => {
      await create(cardAt({ id: 'a-gala', eventId: 'evt-gala' }))

      expect(await repo.listByEvent(WEDDING)).toEqual([])
      expect(await repo.findById(WEDDING, asAnnouncementId('a-gala'))).toBeNull()
      expect(await repo.listAround(WEDDING, atPlus(-MINUTE), 20)).toEqual([])
      expect((await repo.findById(GALA, asAnnouncementId('a-gala')))?.id).toBe('a-gala')
    })

    it('does not delete another event row', async () => {
      await create(cardAt({ id: 'a-gala', eventId: 'evt-gala' }))

      expect(await repo.delete(WEDDING, asAnnouncementId('a-gala'))).toBe(false)
      expect(await repo.findById(GALA, asAnnouncementId('a-gala'))).not.toBeNull()
    })

    // ------------------------------------------------------------------- listing --

    it('lists an event by moment, then by id', async () => {
      await create(cardAt({ id: 'b', offsetMs: 2 * MINUTE }))
      await create(cardAt({ id: 'z', offsetMs: 0 }))
      await create(cardAt({ id: 'c', offsetMs: 5 * MINUTE }))
      await repo.tryCreate(
        anAnnouncement({
          id: 'a',
          eventId: 'evt-wedding',
          at: atPlus(5 * MINUTE),
          kind: 'discreet',
        }),
        MAX_ANNOUNCEMENTS_PER_EVENT,
      )

      expect((await repo.listByEvent(WEDDING)).map((row) => row.id)).toEqual(['z', 'b', 'a', 'c'])
    })

    it('reads around now: starts at the bound, never before it', async () => {
      await create(cardAt({ id: 'before', offsetMs: -2 * MINUTE }))
      await create(cardAt({ id: 'edge', offsetMs: 0 }))
      await create(cardAt({ id: 'after', offsetMs: 2 * MINUTE }))

      const read = await repo.listAround(WEDDING, AT, 20)

      expect(read.map((row) => row.id)).toEqual(['edge', 'after'])
    })

    it('reads around now: at most `limit` of them, the nearest first', async () => {
      for (let i = 0; i < 5; i += 1) await create(cardAt({ id: `a${i}`, offsetMs: i * MINUTE }))

      const read = await repo.listAround(WEDDING, AT, 3)

      expect(read.map((row) => row.id)).toEqual(['a0', 'a1', 'a2'])
    })

    it('reads a discreet announcement launched 29 minutes ago from 31 minutes back', async () => {
      await create(
        cardAt({ id: 'buffet', kind: 'discreet', offsetMs: -29 * MINUTE, seconds: 1800 }),
      )

      const read = await repo.listAround(WEDDING, atPlus(-31 * MINUTE), 20)

      expect(read.map((row) => row.id)).toEqual(['buffet'])
    })

    // -------------------------------------------------------------------- delete --

    it('deletes an announcement in any state, and says whether it did', async () => {
      await create(cardAt({ id: 'a1' }))

      expect(await repo.delete(WEDDING, asAnnouncementId('a1'))).toBe(true)
      expect(await repo.findById(WEDDING, asAnnouncementId('a1'))).toBeNull()
      expect(await repo.delete(WEDDING, asAnnouncementId('a1'))).toBe(false)
    })
  })
}
