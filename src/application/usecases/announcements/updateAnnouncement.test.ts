import { beforeEach, describe, expect, it } from 'vitest'
import { asAnnouncementId } from '../../../domain/shared/ids'
import { AT, anAnnouncement } from '../../testing/builders'
import { FakeAnnouncementRepository } from '../../testing/fakeAnnouncementRepository'
import { makeUpdateAnnouncement } from './updateAnnouncement'
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

describe('updateAnnouncement', () => {
  let s: AnnouncementScene

  /** A card at +1 h with a 5 minute countdown, and a discreet announcement launched now. */
  beforeEach(async () => {
    s = await announcementScene()
    s.announcements.seed(
      anAnnouncement({
        id: 'card',
        eventId: 'evt-wedding',
        text: 'Gâteau',
        at: at(3600),
        countdownSeconds: 300,
      }),
      anAnnouncement({
        id: 'buffet',
        eventId: 'evt-wedding',
        text: 'Le buffet est ouvert',
        kind: 'discreet',
        at: at(-120),
        durationSeconds: 900,
      }),
    )
  })

  const edit = (
    patch: Omit<
      Parameters<AnnouncementScene['update']>[0],
      'eventId' | 'actorId' | 'announcementId'
    >,
    id = 'card',
  ) =>
    s.update({
      eventId: WEDDING,
      actorId: MODERATOR,
      announcementId: asAnnouncementId(id),
      ...patch,
    })

  const stored = async (id: string) => s.announcements.findById(WEDDING, asAnnouncementId(id))

  it('changes every field of an upcoming announcement and announces it once', async () => {
    const result = await edit({
      text: 'Discours',
      at: at(7200).toISOString(),
      durationSeconds: 60,
      countdownSeconds: 600,
    })

    expect(result.ok && result.value.state).toBe('upcoming')
    const card = await stored('card')
    expect(card?.text.value).toBe('Discours')
    expect(card?.at).toEqual(at(7200))
    expect(card?.durationSeconds).toBe(60)
    expect(card?.countdownSeconds).toBe(600)
    expect(s.bus.published).toEqual([{ type: 'announcement.changed', eventId: WEDDING }])
  })

  it('still accepts an edit while the countdown runs', async () => {
    s.clock.advance(3600 * SECOND - 100 * SECOND)

    const result = await edit({ text: 'Discours' })

    expect(result.ok && result.value.state).toBe('counting')
    expect((await stored('card'))?.text.value).toBe('Discours')
  })

  it('refuses an edit once the card is on screen: remove it and launch again', async () => {
    s.clock.advance(3600 * SECOND + 5 * SECOND)

    const result = await edit({ text: 'Discours' })

    expect(!result.ok && result.error.code).toBe('announcement.locked')
    expect((await stored('card'))?.text.value).toBe('Gâteau')
    expect(s.bus.published).toEqual([])
  })

  it('refuses an edit once it is over', async () => {
    s.clock.advance(3600 * SECOND + 60 * SECOND)

    const result = await edit({ text: 'Discours' })

    expect(!result.ok && result.error.code).toBe('announcement.locked')
  })

  it('revalidates the duration when the kind changes: 30 s is not a discreet length', async () => {
    const refused = await edit({ kind: 'discreet' })
    const accepted = await edit({ kind: 'discreet', durationSeconds: 600 })

    expect(!refused.ok && refused.error.code).toBe('announcement.durationInvalid')
    expect(accepted.ok).toBe(true)
    const card = await stored('card')
    expect(card?.kind).toBe('discreet')
    expect(card?.countdownSeconds).toBe(0)
  })

  it('refuses a change of kind once the announcement is on screen', async () => {
    const result = await edit({ kind: 'fullscreen', durationSeconds: 30 }, 'buffet')

    expect(!result.ok && result.error.code).toBe('announcement.locked')
    expect((await stored('buffet'))?.kind).toBe('discreet')
  })

  it('lets the text of a discreet announcement change in place while it is on screen', async () => {
    const result = await edit({ text: 'Le buffet ferme à minuit' }, 'buffet')

    expect(result.ok && result.value.state).toBe('showing')
    const buffet = await stored('buffet')
    expect(buffet?.text.value).toBe('Le buffet ferme à minuit')
    expect(buffet?.at).toEqual(at(-120))
    expect(buffet?.durationSeconds).toBe(900)
    expect(s.bus.published).toEqual([{ type: 'announcement.changed', eventId: WEDDING }])
  })

  it('refuses a new moment or a new duration for a discreet announcement on screen', async () => {
    const moved = await edit({ text: 'Autre', at: at(600).toISOString() }, 'buffet')
    const longer = await edit({ durationSeconds: 1800 }, 'buffet')

    expect(!moved.ok && moved.error.code).toBe('announcement.locked')
    expect(!longer.ok && longer.error.code).toBe('announcement.locked')
    expect((await stored('buffet'))?.durationSeconds).toBe(900)
  })

  it('refuses the text of a fullscreen card on screen, where a discreet one may change', async () => {
    s.announcements.seed(
      anAnnouncement({ id: 'on-screen', eventId: 'evt-wedding', at: at(-5), durationSeconds: 30 }),
    )

    const result = await edit({ text: 'Autre' }, 'on-screen')

    expect(!result.ok && result.error.code).toBe('announcement.locked')
  })

  it('writes and announces nothing when the edit changes nothing', async () => {
    const result = await edit({ text: 'Gâteau', durationSeconds: 30, countdownSeconds: 300 })

    expect(result.ok).toBe(true)
    expect(s.bus.published).toEqual([])
  })

  it('refuses a move onto another announcement of the kind, and keeps the old moment', async () => {
    s.announcements.seed(anAnnouncement({ id: 'other', eventId: 'evt-wedding', at: at(7200) }))

    const result = await edit({ at: at(7210).toISOString() })

    expect(!result.ok && result.error.code).toBe('announcement.overlap')
    expect((await stored('card'))?.at).toEqual(at(3600))
    expect(s.bus.published).toEqual([])
  })

  it('answers announcement.notFound when another moderator deleted it between the read and the write', async () => {
    const racing = new (class extends FakeAnnouncementRepository {
      override async trySave(): ReturnType<FakeAnnouncementRepository['trySave']> {
        return 'notFound'
      }
    })().seed(
      anAnnouncement({ id: 'card', eventId: 'evt-wedding', at: at(3600), countdownSeconds: 300 }),
    )
    const update = makeUpdateAnnouncement({
      events: s.events,
      announcements: racing,
      memberships: s.memberships,
      bus: s.bus,
      clock: s.clock,
    })

    const result = await update({
      eventId: WEDDING,
      actorId: MODERATOR,
      announcementId: asAnnouncementId('card'),
      text: 'Discours',
    })

    expect(!result.ok && result.error.code).toBe('announcement.notFound')
    expect(s.bus.published).toEqual([])
  })

  it('refuses a field the domain refuses, with its own code', async () => {
    const cases = [
      [{ text: '' }, 'announcement.textInvalid'],
      [{ kind: 'banner' }, 'announcement.kindInvalid'],
      [{ at: at(-300).toISOString() }, 'announcement.atInvalid'],
      [{ durationSeconds: 9 }, 'announcement.durationInvalid'],
      [{ countdownSeconds: 7 }, 'announcement.countdownInvalid'],
    ] as const

    for (const [patch, code] of cases) {
      const result = await edit(patch)
      expect(!result.ok && result.error.code).toBe(code)
    }
    expect(s.bus.published).toEqual([])
  })

  it('answers an unknown identifier, and another event identifier, announcement.notFound', async () => {
    s.announcements.seed(anAnnouncement({ id: 'a-gala', eventId: 'evt-gala', text: 'Gala' }))

    const unknown = await edit({ text: 'X' }, 'nope')
    const foreign = await edit({ text: 'Pirate' }, 'a-gala')

    expect(!unknown.ok && unknown.error.code).toBe('announcement.notFound')
    expect(!foreign.ok && foreign.error.code).toBe('announcement.notFound')
    expect((await s.announcements.findById(GALA, asAnnouncementId('a-gala')))?.text.value).toBe(
      'Gala',
    )
  })

  it('refuses a stranger as it refuses an event that does not exist, and a closed event', async () => {
    const stranger = await s.update({
      eventId: WEDDING,
      actorId: STRANGER,
      announcementId: asAnnouncementId('card'),
      text: 'X',
    })
    const closed = await s.update({
      eventId: CLOSED,
      actorId: MODERATOR,
      announcementId: asAnnouncementId('card'),
      text: 'X',
    })

    expect(!stranger.ok && stranger.error.code).toBe('event.notFound')
    // The moderator of the wedding has no part in the closed event: the same answer.
    expect(!closed.ok && closed.error.code).toBe('event.notFound')
  })

  it('refuses a closed event to its own owner with its status', async () => {
    s.announcements.seed(anAnnouncement({ id: 'old', eventId: 'evt-closed', at: at(3600) }))

    const result = await s.update({
      eventId: CLOSED,
      actorId: OWNER,
      announcementId: asAnnouncementId('old'),
      text: 'X',
    })

    expect(!result.ok && result.error.code).toBe('announcement.eventNotOpen')
  })
})
