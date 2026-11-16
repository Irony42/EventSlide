import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_ANNOUNCEMENTS_PER_EVENT } from '../../../domain/announcements/announcementRules'
import { AT, anAnnouncement, anEvent } from '../../testing/builders'
import {
  announcementScene,
  CLOSED,
  DRAFT,
  GALA,
  MODERATOR,
  OWNER,
  STRANGER,
  WEDDING,
  type AnnouncementScene,
} from '../../testing/announcementScene'

const SECOND = 1000
const inSeconds = (seconds: number): string =>
  new Date(AT.getTime() + seconds * SECOND).toISOString()

describe('createAnnouncement', () => {
  let s: AnnouncementScene

  beforeEach(async () => {
    s = await announcementScene()
  })

  const ask = (overrides: Partial<Parameters<AnnouncementScene['create']>[0]> = {}) =>
    s.create({ eventId: WEDDING, actorId: MODERATOR, text: 'Gâteau', ...overrides })

  it('lets a moderator schedule a card, with the defaults of a scheduled fullscreen card', async () => {
    const result = await ask({ at: inSeconds(3600) })

    expect(result.ok && result.value.state).toBe('upcoming')
    const [stored] = await s.announcements.listByEvent(WEDDING)
    expect(stored?.kind).toBe('fullscreen')
    expect(stored?.durationSeconds).toBe(30)
    expect(stored?.countdownSeconds).toBe(300)
    expect(stored?.at.toISOString()).toBe(inSeconds(3600))
    expect(stored?.toProps().createdBy).toBe(MODERATOR)
    expect(stored?.toProps().createdAt).toEqual(AT)
  })

  it('lets the owner schedule one too', async () => {
    expect((await ask({ actorId: OWNER, at: inSeconds(3600) })).ok).toBe(true)
  })

  it('takes a client that sends no kind for fullscreen', async () => {
    await ask({ at: inSeconds(3600) })

    expect((await s.announcements.listByEvent(WEDDING))[0]?.kind).toBe('fullscreen')
  })

  it('keeps the kind it was given: a discreet announcement lasts 15 minutes and has no countdown', async () => {
    await ask({ at: inSeconds(3600), kind: 'discreet' })

    const [stored] = await s.announcements.listByEvent(WEDDING)
    expect(stored?.kind).toBe('discreet')
    expect(stored?.durationSeconds).toBe(900)
    expect(stored?.countdownSeconds).toBe(0)
  })

  it('launches at the server clock when no moment is given, and the card is on screen', async () => {
    const result = await ask()

    expect(result.ok && result.value.state).toBe('showing')
    const [stored] = await s.announcements.listByEvent(WEDDING)
    expect(stored?.at).toEqual(AT)
    expect(stored?.countdownSeconds).toBe(0)
  })

  it('refuses to launch a card while a fullscreen card is on screen', async () => {
    await ask({ text: 'Premier' })
    s.clock.advance(5 * SECOND)

    const second = await ask({ text: 'Second' })

    expect(!second.ok && second.error.code).toBe('announcement.showing')
    expect(await s.announcements.listByEvent(WEDDING)).toHaveLength(1)
  })

  it('launches a card while a discreet announcement is on screen: two layers', async () => {
    await ask({ text: 'Le buffet est ouvert', kind: 'discreet' })
    s.clock.advance(5 * SECOND)

    expect((await ask({ text: 'Gâteau' })).ok).toBe(true)
  })

  it('launches a discreet announcement while a fullscreen card is on screen', async () => {
    await ask({ text: 'Gâteau' })

    expect((await ask({ text: 'Le buffet est ouvert', kind: 'discreet' })).ok).toBe(true)
  })

  it('refuses a discreet launch while another discreet announcement is on screen', async () => {
    await ask({ text: 'Premier', kind: 'discreet' })
    s.clock.advance(5 * SECOND)

    const second = await ask({ text: 'Second', kind: 'discreet' })

    expect(!second.ok && second.error.code).toBe('announcement.showing')
  })

  it('refuses a scheduled card that overlaps another of its kind', async () => {
    await ask({ at: inSeconds(3600) })

    const second = await ask({ at: inSeconds(3629), text: 'Discours' })

    expect(!second.ok && second.error.code).toBe('announcement.overlap')
    expect(await s.announcements.listByEvent(WEDDING)).toHaveLength(1)
  })

  it('accepts a card that starts the second the previous one ends', async () => {
    await ask({ at: inSeconds(3600) })

    expect((await ask({ at: inSeconds(3630), text: 'Discours' })).ok).toBe(true)
  })

  it('accepts a fullscreen card over a discreet announcement', async () => {
    await ask({ at: inSeconds(3600), kind: 'discreet' })

    expect((await ask({ at: inSeconds(3700), text: 'Discours' })).ok).toBe(true)
  })

  it('refuses the fifty-first announcement, and says the ceiling', async () => {
    for (let i = 0; i < MAX_ANNOUNCEMENTS_PER_EVENT; i += 1) {
      s.announcements.seed(
        anAnnouncement({
          id: `old-${i}`,
          eventId: 'evt-wedding',
          at: new Date(AT.getTime() + (i + 1) * 3_600_000),
        }),
      )
    }

    const result = await ask({ at: inSeconds(10) })

    expect(!result.ok && result.error.code).toBe('announcement.limit')
    expect(!result.ok && result.error.details).toEqual({ max: 50 })
    expect(await s.announcements.listByEvent(WEDDING)).toHaveLength(MAX_ANNOUNCEMENTS_PER_EVENT)
  })

  it('lets a draft event prepare its evening', async () => {
    const result = await s.create({
      eventId: DRAFT,
      actorId: OWNER,
      text: 'Discours',
      at: inSeconds(3600),
    })

    expect(result.ok).toBe(true)
  })

  it.each([
    ['closed', CLOSED],
    ['archived', null],
  ] as const)('refuses an event that is %s, and says its status', async (status, id) => {
    const eventId = id ?? WEDDING
    if (id === null) {
      await s.events.delete(WEDDING)
      s.events.seed(anEvent({ id: 'evt-wedding', ownerId: 'user-host', status: 'archived' }))
    }

    const result = await s.create({ eventId, actorId: OWNER, text: 'Gâteau', at: inSeconds(3600) })

    expect(!result.ok && result.error.code).toBe('announcement.eventNotOpen')
    expect(!result.ok && result.error.details).toEqual({ status })
    expect(await s.announcements.listByEvent(eventId)).toEqual([])
    expect(s.bus.published).toEqual([])
  })

  it('answers a stranger exactly as it answers an event that does not exist', async () => {
    const stranger = await s.create({ eventId: WEDDING, actorId: STRANGER, text: 'Gâteau' })
    const missing = await s.create({
      eventId: GALA,
      actorId: OWNER,
      text: 'Gâteau',
    })

    expect(!stranger.ok && stranger.error.code).toBe('event.notFound')
    expect(!missing.ok && missing.error.code).toBe('event.notFound')
    expect(await s.announcements.listByEvent(WEDDING)).toEqual([])
  })

  it('never reads the state of the event before the role', async () => {
    const result = await s.create({ eventId: CLOSED, actorId: STRANGER, text: 'Gâteau' })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers an event the operator took down as an event that is not there', async () => {
    await s.events.setTakenDown(WEDDING, AT)

    const result = await ask({ at: inSeconds(3600) })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses a field the domain refuses, with its own code, and writes nothing', async () => {
    const cases = [
      [{ text: '' }, 'announcement.textInvalid'],
      [{ kind: 'banner' }, 'announcement.kindInvalid'],
      [{ at: inSeconds(-120) }, 'announcement.atInvalid'],
      [{ at: inSeconds(60), durationSeconds: 9 }, 'announcement.durationInvalid'],
      [{ at: inSeconds(60), countdownSeconds: 7 }, 'announcement.countdownInvalid'],
    ] as const

    for (const [overrides, code] of cases) {
      const result = await ask(overrides)
      expect(!result.ok && result.error.code).toBe(code)
    }
    expect(await s.announcements.listByEvent(WEDDING)).toEqual([])
    expect(s.bus.published).toEqual([])
  })

  it('announces the change once, without any data, when something was written', async () => {
    await ask({ at: inSeconds(3600) })

    expect(s.bus.published).toEqual([{ type: 'announcement.changed', eventId: WEDDING }])
  })

  it('announces nothing when the announcement was refused', async () => {
    await ask({ at: inSeconds(3600) })
    s.bus.published.length = 0

    await ask({ at: inSeconds(3610), text: 'Autre' })

    expect(s.bus.published).toEqual([])
  })
})
