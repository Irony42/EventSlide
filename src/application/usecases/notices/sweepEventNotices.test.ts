import { describe, expect, it } from 'vitest'
import type { EventStatus } from '../../../domain/events/eventStatus'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import {
  AT,
  aClient,
  aGuestInvite,
  aGuestbookEntry,
  anEvent,
  aPhoto,
  aUser,
} from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventMailNoticeLedger } from '../../testing/fakeEventMailNoticeLedger'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestInviteRepository } from '../../testing/fakeGuestInviteRepository'
import { FakeMailBudget } from '../../testing/fakeMailBudget'
import { FakeMailPreferenceRepository } from '../../testing/fakeMailPreferenceRepository'
import { FakeMailer } from '../../testing/fakeMailer'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeSweepEventNotices, type SweepEventNoticesDeps } from './sweepEventNotices'

/**
 * A3 and A5 (spec 32, section 3.3), through the sweep. A3: it is 16:00 in Paris on Friday 27 November, the party closed at
 * 02:00 that day. A5: the space's window ends on Saturday 28 November.
 */

const WEDDING = asEventId('evt-wedding')
const HOST = asUserId('user-host')
const CO_HOST = asUserId('user-cohost')
const MODERATOR = asUserId('user-mod')
const NOW = new Date('2026-11-27T15:00:00.000Z')
const CLOSED_AT = new Date('2026-11-27T01:00:00.000Z')
const OPENED_AT = new Date('2026-11-25T10:00:00.000Z')

const build = async (
  options: {
    now?: Date
    status?: EventStatus
    closedAt?: Date | null
    openedAt?: Date | null
    retentionDays?: number
    scheduledCloseAt?: Date | null
    client?: Parameters<typeof aClient>[0] | null
    zone?: string | null
    published?: { photos: number; clips: number; messages: number }
    hostMailNotices?: boolean
    budgetMax?: number | null
  } = {},
) => {
  const clients = new FakeClientRepository()
  const events = new FakeEventRepository({ clients })
  const users = new FakeUserRepository().seed(
    aUser({ id: HOST, email: 'hote@example.test' }),
    aUser({ id: CO_HOST, email: 'cohote@example.test' }),
    aUser({ id: MODERATOR, email: 'mod@example.test' }),
  )
  const preferences = new FakeMailPreferenceRepository().withUsers(HOST, CO_HOST, MODERATOR)
  const memberships = new FakeMembershipRepository({ users, mailPreferences: preferences }).seed(
    { eventId: WEDDING, userId: HOST, role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: CO_HOST, role: 'owner', grantedAt: new Date(AT.getTime() + 1) },
    { eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT },
  )
  const client = options.client === undefined ? {} : options.client
  if (client !== null) clients.seed(aClient({ id: 'client-1', ...client }))
  const status = options.status ?? 'closed'
  events.seed(
    anEvent({
      id: WEDDING,
      slug: 'camille-et-sacha',
      joinCode: 'H7K2QM',
      name: 'Camille et Sacha',
      status,
      closedAt: options.closedAt === undefined ? CLOSED_AT : options.closedAt,
      openedAt: options.openedAt === undefined ? OPENED_AT : options.openedAt,
      ...(options.retentionDays === undefined
        ? {}
        : { settings: { retentionDays: options.retentionDays } }),
      scheduledCloseAt: options.scheduledCloseAt ?? null,
      ...(client === null
        ? {}
        : { clientId: 'client-1', clientSuspendedAt: client.suspendedAt ?? null }),
    }),
  )
  const invites = new FakeGuestInviteRepository()
  if (options.zone !== null) {
    await invites.create(
      aGuestInvite({
        eventId: WEDDING,
        enabled: true,
        startsAt: '2026-11-26T18:00:00.000Z',
        timeZone: options.zone ?? 'Europe/Paris',
      }),
    )
  }
  const held = options.published ?? { photos: 3, clips: 1, messages: 2 }
  const photos = new FakePhotoRepository()
  for (let i = 0; i < held.photos; i += 1) {
    photos.seed(aPhoto({ id: `p-${i}`, eventId: WEDDING, status: 'published' }))
  }
  for (let i = 0; i < held.clips; i += 1) {
    photos.seed(aPhoto({ id: `c-${i}`, eventId: WEDDING, status: 'published', clip: {} }))
  }
  photos.seed(
    aPhoto({ id: 'pending', eventId: WEDDING, status: 'pending' }),
    aPhoto({ id: 'hidden', eventId: WEDDING, status: 'hidden' }),
  )
  const guestbook = new FakeGuestbookRepository()
  for (let i = 0; i < held.messages; i += 1) {
    guestbook.seed(
      aGuestbookEntry({
        id: `m-${i}`,
        eventId: WEDDING,
        text: 'Un mot très secret de Léa',
        moderation: 'auto',
      }),
    )
  }
  guestbook.seed(aGuestbookEntry({ id: 'm-pending', eventId: WEDDING, text: 'Pas encore' }))
  const ledger = new FakeEventMailNoticeLedger().withEvents(WEDDING)
  const budget = new FakeMailBudget(options.budgetMax ?? null)
  const mailer = new FakeMailer()
  const logger = new CapturingLogger()
  const clock = new FakeClock(options.now ?? NOW)
  const deps: SweepEventNoticesDeps = {
    events,
    clients,
    invites,
    photos,
    guestbook,
    memberships,
    notices: ledger,
    budget,
    mailer,
    clock,
    logger,
    capNoticeDays: 30,
    publicUrl: 'https://photos.example.test',
    hostMailNotices: options.hostMailNotices ?? true,
  }
  return {
    sweep: makeSweepEventNotices(deps),
    deps,
    mailer,
    ledger,
    budget,
    clock,
    preferences,
    events,
    logger,
  }
}

const WINDOW = {
  status: 'live' as const,
  closedAt: null,
  client: { ceilings: { maxLiveDays: 3 } },
  // The window ends on 28 November at 10:00 UTC (opened 25 November at 10:00, three days).
  now: new Date('2026-11-27T12:00:00.000Z'),
}

describe('after the party (A3)', () => {
  it('tells every owner, and not the moderator, what was published, once the party is 12 hours over', async () => {
    const world = await build()

    const report = await world.sweep()

    expect(report).toMatchObject({ sent: 2, unsent: 0, skippedBudget: 0, failed: [] })
    expect(report.noticed).toEqual([{ eventId: WEDDING, kind: 'eventClosed' }])
    expect(world.mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'cohote@example.test',
      'hote@example.test',
    ])
    const text = world.mailer.sent[0]?.text ?? ''
    expect(text).toContain('est terminé')
    expect(text).toContain('3 photos, 1 vidéo, 2 messages au livre d’or.')
    expect(text).toContain('https://photos.example.test/admin/events/camille-et-sacha\n')
    expect(world.ledger.noted).toEqual([{ eventId: WEDDING, kind: 'eventClosed', key: 'first' }])
  })

  it('counts only what is published: not the pending, the hidden nor the pending messages, and says nothing a guest wrote', async () => {
    const world = await build()

    await world.sweep()

    const text = world.mailer.sent[0]?.text ?? ''
    expect(text).toContain('3 photos, 1 vidéo, 2 messages')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('Pas encore')
  })

  it('says when the album goes, from the retention the host chose', async () => {
    const world = await build({ retentionDays: 90 })

    await world.sweep()

    // 27 November 01:00 UTC + 90 days.
    expect(world.mailer.sent[0]?.text).toContain('L’album sera supprimé le 25 février 2027.')
  })

  it('is written once: the next pass finds it noted, and an event that closed, reopened and closed again gets no second one', async () => {
    const world = await build()
    await world.sweep()

    world.clock.advance(3_600_000)
    expect(await world.sweep()).toMatchObject({ noticed: [], sent: 0 })
    expect(world.mailer.sent).toHaveLength(2)

    const reclosed = await build()
    await reclosed.ledger.note(
      WEDDING,
      'eventClosed',
      'first',
      new Date('2026-11-20T10:00:00.000Z'),
    )
    expect(await reclosed.sweep()).toMatchObject({ noticed: [], sent: 0 })
  })

  it('owes nothing before 12 hours, nothing from 48 hours, and nothing once the album is gone', async () => {
    const early = await build({ now: new Date(CLOSED_AT.getTime() + 12 * 3_600_000 - 1) })
    expect((await early.sweep()).noticed).toEqual([])

    const exactly = await build({ now: new Date(CLOSED_AT.getTime() + 12 * 3_600_000) })
    expect((await exactly.sweep()).noticed).toHaveLength(1)

    const late = await build({ now: new Date(CLOSED_AT.getTime() + 48 * 3_600_000 + 1) })
    expect((await late.sweep()).noticed).toEqual([])

    // One day of retention: the album went at 02:00 on the 28th, before the notice's 48 hours are over.
    const purged = await build({
      retentionDays: 1,
      now: new Date('2026-11-28T08:00:00.000Z'),
    })
    expect((await purged.sweep()).noticed).toEqual([])
    expect(purged.mailer.sent).toEqual([])
  })

  it('is noted without a mail for an evening with nothing published', async () => {
    const world = await build({ published: { photos: 0, clips: 0, messages: 0 } })

    const report = await world.sweep()

    expect(report.noticed).toEqual([{ eventId: WEDDING, kind: 'eventClosed' }])
    expect(world.mailer.sent).toEqual([])
    expect(world.ledger.noted).toHaveLength(1)
  })

  it('is sent for an evening with only messages, and for one with only a clip', async () => {
    const messages = await build({ published: { photos: 0, clips: 0, messages: 4 } })
    await messages.sweep()
    expect(messages.mailer.sent[0]?.text).toContain('4 messages au livre d’or.')
    expect(messages.mailer.sent[0]?.text).not.toMatch(/d+ photos?/)

    const clip = await build({ published: { photos: 0, clips: 1, messages: 0 } })
    await clip.sweep()
    expect(clip.mailer.sent[0]?.text).toContain('1 vidéo.')
  })

  it('waits for the morning, and notes nothing, at night in the zone of the invitation', async () => {
    // 22:30 UTC is 23:30 in Paris.
    const world = await build({ now: new Date('2026-11-27T22:30:00.000Z') })
    expect(await world.sweep()).toMatchObject({ noticed: [], sent: 0 })
    expect(world.ledger.noted).toEqual([])

    // 07:00 UTC the next day is 08:00 in Paris, 31 hours after the closing.
    world.clock.set(new Date('2026-11-28T07:00:00.000Z'))
    expect((await world.sweep()).noticed).toHaveLength(1)
  })

  it('reads the quiet hours in Paris when the event has no invitation', async () => {
    const world = await build({ zone: null, now: new Date('2026-11-27T22:30:00.000Z') })

    expect(await world.sweep()).toMatchObject({ noticed: [] })
  })

  it('leaves out an owner who switched the event family off, and notes without a mail when all did', async () => {
    const world = await build()
    await world.preferences.save(CO_HOST, { event: false })
    await world.sweep()
    expect(world.mailer.sent.map((mail) => mail.to)).toEqual(['hote@example.test'])

    const nobody = await build()
    await nobody.preferences.save(HOST, { event: false })
    await nobody.preferences.save(CO_HOST, { event: false })
    expect((await nobody.sweep()).noticed).toEqual([{ eventId: WEDDING, kind: 'eventClosed' }])
    expect(nobody.mailer.sent).toEqual([])
  })

  it('keeps the replies switch out of it', async () => {
    const world = await build()
    await world.preferences.save(HOST, { rsvp: false })

    await world.sweep()

    expect(world.mailer.sent.map((mail) => mail.to)).toContain('hote@example.test')
  })

  it('is held back by the day budget, neither noted nor sent, and goes the next day while it is fresh', async () => {
    const world = await build({ budgetMax: 2 })
    await world.budget.count('2026-11-27', 1)

    const held = await world.sweep()

    expect(held).toMatchObject({ noticed: [], sent: 0, skippedBudget: 1 })
    expect(world.ledger.noted).toEqual([])

    world.clock.set(new Date('2026-11-28T09:00:00.000Z'))
    const later = await world.sweep()

    expect(later.noticed).toEqual([{ eventId: WEDDING, kind: 'eventClosed' }])
    expect(world.mailer.sent).toHaveLength(2)
  })

  it('sends nothing when another sweep noted it first: the lost note', async () => {
    const world = await build()
    const lost = { note: async () => false, has: async () => false }

    const report = await makeSweepEventNotices({ ...world.deps, notices: lost })()

    expect(report).toMatchObject({ noticed: [], sent: 0 })
    expect(world.mailer.sent).toEqual([])
  })

  it('counts a mail the relay refused as unsent and does not send it again', async () => {
    const world = await build()
    world.mailer.failNextWith('rejected')

    const report = await world.sweep()

    expect(report).toMatchObject({ sent: 1, unsent: 1 })
    world.clock.advance(3_600_000)
    expect(await world.sweep()).toMatchObject({ sent: 0 })
  })

  it('is stopped by HOST_MAIL_NOTICES=off, and without a relay sends and notes nothing', async () => {
    const off = await build({ hostMailNotices: false })
    expect(await off.sweep()).toMatchObject({ noticed: [], sent: 0 })
    expect(off.ledger.noted).toEqual([])

    const world = await build()
    const none = makeSweepEventNotices({
      ...world.deps,
      mailer: {
        canDeliver: false,
        send: async () => {
          throw new Error('no relay')
        },
      },
    })
    expect(await none()).toMatchObject({ noticed: [], sent: 0 })
    expect(world.ledger.noted).toEqual([])
  })

  it('writes about no event the operator took down, of a suspended client or of a client being closed', async () => {
    const down = await build()
    await down.events.setTakenDown(WEDDING, NOW)
    const suspended = await build({ client: { suspendedAt: AT } })
    const closing = await build({ client: { purgeAfter: new Date('2027-06-01T00:00:00.000Z') } })

    for (const world of [down, suspended, closing]) {
      expect(await world.sweep()).toMatchObject({ noticed: [], sent: 0 })
      expect(world.ledger.noted).toEqual([])
    }
  })

  it('serves an event with no client in the language of its wall', async () => {
    const world = await build({ client: null })

    await world.sweep()

    expect(world.mailer.sent).toHaveLength(2)
  })

  it('does not look at an archived event, nor a live one', async () => {
    const archived = await build({ status: 'archived' })
    expect(await archived.sweep()).toMatchObject({ noticed: [], sent: 0 })

    const live = await build({ status: 'live', closedAt: null })
    expect((await live.sweep()).noticed).toEqual([])
  })

  it('lists the event it could not examine and goes on, and says nothing when it cannot list', async () => {
    const world = await build()
    const broken = makeSweepEventNotices({
      ...world.deps,
      photos: {
        countsByStatus: async () => {
          throw new RangeError('secret hote@example.test')
        },
        countPublishedPhotos: async () => 0,
      },
    })

    const report = await broken()

    expect(report).toMatchObject({ noticed: [], sent: 0, failed: [WEDDING] })
    expect(
      world.logger.lines.find((entry) => entry.message === 'an event notice could not be examined')
        ?.context,
    ).toEqual({ eventId: WEDDING, error: 'RangeError' })

    const plain = makeSweepEventNotices({
      ...world.deps,
      photos: {
        countsByStatus: async () => {
          throw 'plain'
        },
        countPublishedPhotos: async () => 0,
      },
    })
    expect(await plain()).toMatchObject({ failed: [WEDDING] })
    expect(
      world.logger.lines
        .filter((entry) => entry.message === 'an event notice could not be examined')
        .map((entry) => entry.context),
    ).toEqual([
      { eventId: WEDDING, error: 'RangeError' },
      { eventId: WEDDING, error: 'unknown' },
    ])

    const unlisted = makeSweepEventNotices({
      ...world.deps,
      events: {
        listClosedBetween: async () => {
          throw 'plain'
        },
        listLiveOfClients: async () => [],
      },
    })
    expect(await unlisted()).toMatchObject({ noticed: [], failed: [] })
    const unlistedByAnError = makeSweepEventNotices({
      ...world.deps,
      events: {
        listClosedBetween: async () => [],
        listLiveOfClients: async () => {
          throw new RangeError('secret hote@example.test')
        },
      },
    })
    expect(await unlistedByAnError()).toMatchObject({ noticed: [], failed: [] })
    expect(
      world.logger.lines
        .filter((entry) => entry.message === 'event notices could not list the events')
        .map((entry) => entry.context),
    ).toEqual([{ error: 'unknown' }, { error: 'RangeError' }])
    expect(
      world.logger.lines.find(
        (entry) => entry.message === 'event notices could not list the events',
      )?.context,
    ).toEqual({ error: 'unknown' })
  })
})

describe('the wall closes within 24 hours (A5)', () => {
  it('tells every owner the day the wall closes, with the page of the event, once', async () => {
    const world = await build(WINDOW)

    const report = await world.sweep()

    expect(report.noticed).toEqual([{ eventId: WEDDING, kind: 'windowEnding' }])
    expect(world.mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'cohote@example.test',
      'hote@example.test',
    ])
    expect(world.mailer.sent[0]?.text).toContain('se fermera le 28 novembre 2026')
    expect(world.mailer.sent[0]?.text).toContain(
      'https://photos.example.test/admin/events/camille-et-sacha\n',
    )
    expect(world.ledger.noted).toEqual([
      { eventId: WEDDING, kind: 'windowEnding', key: '2026-11-28T10:00:00.000Z' },
    ])

    world.clock.advance(3_600_000)
    expect(await world.sweep()).toMatchObject({ noticed: [], sent: 0 })
  })

  it('reads the day in the zone of the invitation: 23:30 UTC is already the next day in Paris', async () => {
    const world = await build({
      ...WINDOW,
      openedAt: new Date('2026-11-25T23:30:00.000Z'),
      now: new Date('2026-11-28T08:00:00.000Z'),
    })

    await world.sweep()

    expect(world.mailer.sent[0]?.text).toContain('se fermera le 29 novembre 2026')
  })

  it('reads it in UTC when the event has no invitation', async () => {
    const world = await build({
      ...WINDOW,
      zone: null,
      openedAt: new Date('2026-11-25T23:30:00.000Z'),
      now: new Date('2026-11-28T08:00:00.000Z'),
    })

    await world.sweep()

    expect(world.mailer.sent[0]?.text).toContain('se fermera le 28 novembre 2026')
  })

  it('owes nothing when the window ends in more than a day, has ended, or does not exist', async () => {
    const far = await build({ ...WINDOW, now: new Date('2026-11-27T09:59:00.000Z') })
    expect((await far.sweep()).noticed).toEqual([])

    const over = await build({ ...WINDOW, now: new Date('2026-11-28T10:00:00.000Z') })
    expect((await over.sweep()).noticed).toEqual([])

    const open = await build({ ...WINDOW, client: {} })
    expect((await open.sweep()).noticed).toEqual([])

    const neverOpened = await build({ ...WINDOW, openedAt: null })
    expect((await neverOpened.sweep()).noticed).toEqual([])

    expect([far, over, open, neverOpened].flatMap((world) => world.mailer.sent)).toEqual([])
  })

  it('owes nothing for an event that belongs to no client: there is no window', async () => {
    const world = await build({ ...WINDOW, client: null })

    expect((await world.sweep()).noticed).toEqual([])
  })

  it('is not owed when a closing the host scheduled falls before the window ends, and is when it falls after or has passed', async () => {
    const before = await build({
      ...WINDOW,
      scheduledCloseAt: new Date('2026-11-28T09:00:00.000Z'),
    })
    expect((await before.sweep()).noticed).toEqual([])

    const after = await build({
      ...WINDOW,
      scheduledCloseAt: new Date('2026-11-28T11:00:00.000Z'),
    })
    expect((await after.sweep()).noticed).toHaveLength(1)

    const past = await build({
      ...WINDOW,
      scheduledCloseAt: new Date('2026-11-27T11:00:00.000Z'),
    })
    expect((await past.sweep()).noticed).toHaveLength(1)
  })

  it('waits for the morning, and notes nothing, at night in the zone of the invitation, and writes at 08:00 local', async () => {
    // 22:30 UTC on the 27th is 23:30 in Paris; the window ends 11 hours later.
    const world = await build({ ...WINDOW, now: new Date('2026-11-27T22:30:00.000Z') })
    expect(await world.sweep()).toMatchObject({ noticed: [], sent: 0 })
    expect(world.ledger.noted).toEqual([])

    world.clock.set(new Date('2026-11-28T07:00:00.000Z'))
    expect((await world.sweep()).noticed).toHaveLength(1)
  })

  it('leaves out an owner who switched the event family off', async () => {
    const world = await build(WINDOW)
    await world.preferences.save(CO_HOST, { event: false })

    await world.sweep()

    expect(world.mailer.sent.map((mail) => mail.to)).toEqual(['hote@example.test'])
  })

  it('is held back by the day budget and goes when there is room', async () => {
    const world = await build({ ...WINDOW, budgetMax: 1 })

    const held = await world.sweep()
    expect(held).toMatchObject({ noticed: [], sent: 0, skippedBudget: 1 })

    world.clock.set(new Date('2026-11-28T08:00:00.000Z'))
    expect(await world.sweep()).toMatchObject({ skippedBudget: 1 })
  })

  it('is stopped by HOST_MAIL_NOTICES=off and left out for a suspended client or one being closed', async () => {
    const off = await build({ ...WINDOW, hostMailNotices: false })
    expect(await off.sweep()).toMatchObject({ noticed: [], sent: 0 })

    const suspended = await build({ ...WINDOW, client: { ...WINDOW.client, suspendedAt: AT } })
    expect(await suspended.sweep()).toMatchObject({ noticed: [], sent: 0 })

    const closing = await build({
      ...WINDOW,
      client: { ...WINDOW.client, purgeAfter: new Date('2027-06-01T00:00:00.000Z') },
    })
    expect(await closing.sweep()).toMatchObject({ noticed: [], sent: 0 })

    const down = await build(WINDOW)
    await down.events.setTakenDown(WEDDING, NOW)
    expect(await down.sweep()).toMatchObject({ noticed: [], sent: 0 })
  })

  it('does not look at a closed event for its window', async () => {
    const world = await build({
      ...WINDOW,
      status: 'closed',
      closedAt: new Date('2026-11-27T11:00:00.000Z'),
    })

    expect((await world.sweep()).noticed).toEqual([])
  })

  it('lists the event it could not examine and goes on', async () => {
    const world = await build(WINDOW)
    const broken = makeSweepEventNotices({
      ...world.deps,
      clients: {
        findById: async () => null,
        contextForEvent: async () => {
          throw new Error('locked')
        },
      },
    })

    expect(await broken()).toMatchObject({ noticed: [], failed: [WEDDING] })
  })
})
