import { beforeEach, describe, expect, it } from 'vitest'
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

describe('listAnnouncements', () => {
  let s: AnnouncementScene

  beforeEach(async () => {
    s = await announcementScene()
  })

  it('lists the event announcements by moment, each with its state at the server clock', async () => {
    s.announcements.seed(
      anAnnouncement({ id: 'later', eventId: 'evt-wedding', at: at(3600), countdownSeconds: 300 }),
      anAnnouncement({ id: 'now', eventId: 'evt-wedding', at: at(-5) }),
      anAnnouncement({ id: 'counting', eventId: 'evt-wedding', at: at(100), countdownSeconds: 300 }),
      anAnnouncement({ id: 'past', eventId: 'evt-wedding', at: at(-600) }),
    )

    const result = await s.list({ eventId: WEDDING, actorId: MODERATOR })

    expect(result.ok && result.value.serverNowMs).toBe(AT.getTime())
    expect(
      result.ok && result.value.announcements.map((row) => [row.announcement.id, row.state]),
    ).toEqual([
      ['past', 'over'],
      ['now', 'showing'],
      ['counting', 'counting'],
      ['later', 'upcoming'],
    ])
  })

  it('lists nothing for an event with no announcement', async () => {
    const result = await s.list({ eventId: WEDDING, actorId: OWNER })

    expect(result.ok && result.value.announcements).toEqual([])
  })

  it('never lists another event announcements', async () => {
    s.announcements.seed(anAnnouncement({ id: 'a-gala', eventId: 'evt-gala', at: at(3600) }))

    const result = await s.list({ eventId: WEDDING, actorId: MODERATOR })

    expect(result.ok && result.value.announcements).toEqual([])
    expect((await s.list({ eventId: GALA, actorId: MODERATOR })).ok).toBe(false)
  })

  it('stays readable once the event is closed: the list is a record', async () => {
    s.announcements.seed(anAnnouncement({ id: 'old', eventId: 'evt-closed', at: at(-600) }))

    const result = await s.list({ eventId: CLOSED, actorId: OWNER })

    expect(result.ok && result.value.announcements).toHaveLength(1)
  })

  it('answers a stranger as an event that does not exist', async () => {
    const result = await s.list({ eventId: WEDDING, actorId: STRANGER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers an event the operator took down as an event that is not there', async () => {
    await s.events.setTakenDown(WEDDING, AT)

    const result = await s.list({ eventId: WEDDING, actorId: OWNER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
