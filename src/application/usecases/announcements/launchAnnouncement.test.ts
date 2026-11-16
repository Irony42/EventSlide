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

describe('launchAnnouncement', () => {
  let s: AnnouncementScene

  beforeEach(async () => {
    s = await announcementScene()
  })

  const launch = (id: string, actorId = MODERATOR) =>
    s.launch({ eventId: WEDDING, actorId, announcementId: asAnnouncementId(id) })

  const stored = async (id: string) => s.announcements.findById(WEDDING, asAnnouncementId(id))

  it('starts a scheduled card now, without its countdown, keeping its text and duration', async () => {
    s.announcements.seed(
      anAnnouncement({
        id: 'card',
        eventId: 'evt-wedding',
        text: 'Gâteau',
        at: at(3600),
        durationSeconds: 60,
        countdownSeconds: 600,
      }),
    )

    const result = await launch('card')

    expect(result.ok && result.value.state).toBe('showing')
    const card = await stored('card')
    expect(card?.at).toEqual(AT)
    expect(card?.countdownSeconds).toBe(0)
    expect(card?.durationSeconds).toBe(60)
    expect(card?.text.value).toBe('Gâteau')
    expect(s.bus.published).toEqual([{ type: 'announcement.changed', eventId: WEDDING }])
  })

  it('starts one that is counting down', async () => {
    s.announcements.seed(
      anAnnouncement({ id: 'card', eventId: 'evt-wedding', at: at(100), countdownSeconds: 300 }),
    )

    expect((await launch('card')).ok).toBe(true)
  })

  it('replays one that is over ("Relancer")', async () => {
    s.announcements.seed(anAnnouncement({ id: 'card', eventId: 'evt-wedding', at: at(-600) }))

    const result = await launch('card')

    expect(result.ok && result.value.state).toBe('showing')
    expect((await stored('card'))?.at).toEqual(AT)
  })

  it('refuses one that is on screen itself', async () => {
    s.announcements.seed(anAnnouncement({ id: 'card', eventId: 'evt-wedding', at: at(-5) }))

    const result = await launch('card')

    expect(!result.ok && result.error.code).toBe('announcement.showing')
  })

  it('refuses while another card of the same kind is on screen', async () => {
    s.announcements.seed(
      anAnnouncement({ id: 'on-screen', eventId: 'evt-wedding', at: at(-5) }),
      anAnnouncement({ id: 'next', eventId: 'evt-wedding', at: at(3600) }),
    )

    const result = await launch('next')

    expect(!result.ok && result.error.code).toBe('announcement.showing')
    expect((await stored('next'))?.at).toEqual(at(3600))
    expect(s.bus.published).toEqual([])
  })

  it('launches a discreet announcement while a fullscreen card is on screen', async () => {
    s.announcements.seed(
      anAnnouncement({ id: 'on-screen', eventId: 'evt-wedding', at: at(-5) }),
      anAnnouncement({ id: 'buffet', eventId: 'evt-wedding', kind: 'discreet', at: at(3600) }),
    )

    expect((await launch('buffet')).ok).toBe(true)
  })

  it('refuses a discreet launch while another discreet announcement is on screen', async () => {
    s.announcements.seed(
      anAnnouncement({ id: 'on-screen', eventId: 'evt-wedding', kind: 'discreet', at: at(-5) }),
      anAnnouncement({ id: 'buffet', eventId: 'evt-wedding', kind: 'discreet', at: at(7200) }),
    )

    const result = await launch('buffet')

    expect(!result.ok && result.error.code).toBe('announcement.showing')
  })

  it('refuses a launch that would touch the next announcement of its kind', async () => {
    s.announcements.seed(
      anAnnouncement({ id: 'soon', eventId: 'evt-wedding', at: at(10) }),
      anAnnouncement({ id: 'later', eventId: 'evt-wedding', at: at(3600) }),
    )

    const result = await launch('later')

    expect(!result.ok && result.error.code).toBe('announcement.overlap')
    expect((await stored('later'))?.at).toEqual(at(3600))
  })

  it('answers an unknown identifier and another event identifier announcement.notFound', async () => {
    s.announcements.seed(anAnnouncement({ id: 'a-gala', eventId: 'evt-gala', at: at(3600) }))

    const unknown = await launch('nope')
    const foreign = await launch('a-gala')

    expect(!unknown.ok && unknown.error.code).toBe('announcement.notFound')
    expect(!foreign.ok && foreign.error.code).toBe('announcement.notFound')
    expect((await s.announcements.findById(GALA, asAnnouncementId('a-gala')))?.at).toEqual(at(3600))
  })

  it('refuses a stranger and a closed event', async () => {
    s.announcements.seed(anAnnouncement({ id: 'old', eventId: 'evt-closed', at: at(-600) }))

    const stranger = await launch('old', STRANGER)
    const closed = await s.launch({
      eventId: CLOSED,
      actorId: OWNER,
      announcementId: asAnnouncementId('old'),
    })

    expect(!stranger.ok && stranger.error.code).toBe('event.notFound')
    expect(!closed.ok && closed.error.code).toBe('announcement.eventNotOpen')
  })
})
