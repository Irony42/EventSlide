import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../testing/fakeClock'
import { FakeHostAnnouncementRepository } from '../../testing/fakeHostAnnouncementRepository'
import { makePruneHostAnnouncements } from './pruneHostAnnouncements'

/**
 * The retention of the announcements (spec 32, lot 2): the record of who was reached goes 30 days after the sending finished,
 * the operator's text 365 days after it was written.
 */

const NOW = new Date('2027-12-01T03:00:00.000Z')
const DAY = 86_400_000
const ago = (days: number): Date => new Date(NOW.getTime() - days * DAY)
const row = (id: string, createdDaysAgo: number, finishedDaysAgo: number | null) => ({
  id,
  subject: id,
  text: id,
  link: null,
  createdBy: null,
  createdAt: ago(createdDaysAgo),
  finishedAt: finishedDaysAgo === null ? null : ago(finishedDaysAgo),
})

describe('pruneHostAnnouncements', () => {
  const build = async () => {
    const announcements = new FakeHostAnnouncementRepository().withOwner('user-a', 'a@example.test')
    await announcements.create(row('a-ancient', 400, 399))
    await announcements.create(row('a-old', 60, 31))
    await announcements.create(row('a-recent', 40, 29))
    await announcements.create(row('a-going', 5, null))
    for (const id of ['a-ancient', 'a-old', 'a-recent', 'a-going']) {
      await announcements.recordDelivery(id, 'user-a', ago(10))
    }
    return {
      announcements,
      prune: makePruneHostAnnouncements({ announcements, clock: new FakeClock(NOW) }),
    }
  }

  it('erases the deliveries of what finished more than 30 days ago, and the text of what is more than 365 days old', async () => {
    const { announcements, prune } = await build()

    const report = await prune()

    // Two deliveries go first (the ancient one's and the 31-day-finished one's), then the 400-day-old text.
    expect(report).toEqual({ deliveries: 2, announcements: 1 })
    const left = Object.fromEntries(
      (await announcements.listRecent(10)).map((progress) => [
        progress.announcement.id,
        progress.delivered,
      ]),
    )
    expect(left).toEqual({ 'a-old': 0, 'a-recent': 1, 'a-going': 1 })
  })

  it('keeps a delivery exactly 30 days after the end and an announcement exactly 365 days', async () => {
    const announcements = new FakeHostAnnouncementRepository().withOwner('user-a', 'a@example.test')
    await announcements.create(row('a-edge', 365, 30))
    await announcements.recordDelivery('a-edge', 'user-a', ago(30))

    const report = await makePruneHostAnnouncements({ announcements, clock: new FakeClock(NOW) })()

    expect(report).toEqual({ deliveries: 0, announcements: 0 })
  })

  it('never makes a finished announcement owed again by erasing its deliveries', async () => {
    const { announcements, prune } = await build()

    await prune()

    expect((await announcements.unfinished()).map((held) => held.id)).toEqual(['a-going'])
  })
})
