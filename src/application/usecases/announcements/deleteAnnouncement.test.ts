import { beforeEach, describe, expect, it } from 'vitest'
import { asAnnouncementId } from '../../../domain/shared/ids'
import { AT, anAnnouncement } from '../../testing/builders'
import {
  announcementScene,
  CLOSED,
  GALA,
  MODERATOR,
  OWNER,
  STRANGER,
  WEDDING,
  type AnnouncementScene,
} from '../../testing/announcementScene'

const SECOND = 1000
const at = (seconds: number): Date => new Date(AT.getTime() + seconds * SECOND)

describe('deleteAnnouncement', () => {
  let s: AnnouncementScene

  beforeEach(async () => {
    s = await announcementScene()
  })

  const remove = (id: string, actorId = MODERATOR) =>
    s.remove({ eventId: WEDDING, actorId, announcementId: asAnnouncementId(id) })

  it.each([
    ['upcoming', 3600, 300],
    ['counting', 100, 300],
    ['showing', -5, 0],
    ['over', -600, 0],
  ])('deletes an announcement that is %s', async (_state, offset, countdown) => {
    s.announcements.seed(
      anAnnouncement({
        id: 'a1',
        eventId: 'evt-wedding',
        at: at(offset),
        countdownSeconds: countdown,
      }),
    )

    const result = await remove('a1')

    expect(result.ok).toBe(true)
    expect(await s.announcements.listByEvent(WEDDING)).toEqual([])
    expect(s.bus.published).toEqual([{ type: 'announcement.changed', eventId: WEDDING }])
  })

  it('answers announcement.notFound the second time, and announces nothing', async () => {
    s.announcements.seed(anAnnouncement({ id: 'a1', eventId: 'evt-wedding', at: at(3600) }))
    await remove('a1')
    s.bus.published.length = 0

    const again = await remove('a1')

    expect(!again.ok && again.error.code).toBe('announcement.notFound')
    expect(s.bus.published).toEqual([])
  })

  it('never deletes another event announcement', async () => {
    s.announcements.seed(anAnnouncement({ id: 'a-gala', eventId: 'evt-gala', at: at(3600) }))

    const result = await remove('a-gala')

    expect(!result.ok && result.error.code).toBe('announcement.notFound')
    expect(await s.announcements.listByEvent(GALA)).toHaveLength(1)
  })

  it('refuses a stranger, and a closed event with its status', async () => {
    s.announcements.seed(anAnnouncement({ id: 'old', eventId: 'evt-closed', at: at(-600) }))

    const stranger = await remove('old', STRANGER)
    const closed = await s.remove({
      eventId: CLOSED,
      actorId: OWNER,
      announcementId: asAnnouncementId('old'),
    })

    expect(!stranger.ok && stranger.error.code).toBe('event.notFound')
    expect(!closed.ok && closed.error.code).toBe('announcement.eventNotOpen')
    expect(await s.announcements.listByEvent(CLOSED)).toHaveLength(1)
  })
})
