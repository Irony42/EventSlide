import { describe, expect, it } from 'vitest'
import { aRsvp } from '../../../domain/guestRsvps/testing/rsvpFixtures'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient, aGuestInvite, anEvent, aUser } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventMailNoticeLedger } from '../../testing/fakeEventMailNoticeLedger'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestInviteRepository } from '../../testing/fakeGuestInviteRepository'
import { FakeGuestRsvpRepository } from '../../testing/fakeGuestRsvpRepository'
import { FakeMailBudget } from '../../testing/fakeMailBudget'
import { FakeMailer } from '../../testing/fakeMailer'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import type { EventMailNoticeLedger } from '../../ports/eventMailNoticeLedger'
import { err } from '../../../domain/shared/result'
import { mailFailure, type Mailer } from '../../ports/mailer'
import { makeSweepRsvpNotices } from './sweepRsvpNotices'

/**
 * R1, the warning before the replies are erased (spec 32). Every case is stated in days from `NOW`: "the replies
 * go in 7 days" is the sentence the host is told. `NOW` is 13:00 in Paris, inside the hours mails may leave.
 */

const DAY = 86_400_000
const NOW = new Date('2026-12-01T12:00:00.000Z')
const WEDDING = asEventId('evt-wedding')
const HOST = asUserId('user-host')
const CO_HOST = asUserId('user-cohost')
const MODERATOR = asUserId('user-mod')
const OFF_DUTY = asUserId('user-off')

/** A closed event whose replies go `inDays` days after NOW (30 days after it closed), its purge much later. */
const closedGoingIn = (inDays: number, extra: Parameters<typeof anEvent>[0] = {}) =>
  anEvent({
    id: WEDDING,
    slug: 'camille-et-sacha',
    joinCode: 'H7K2QM',
    name: 'Camille et Sacha',
    status: 'closed',
    closedAt: new Date(NOW.getTime() + (inDays - 30) * DAY),
    settings: { retentionDays: 365 },
    ...extra,
  })

const build = (
  options: { mailer?: Mailer; now?: Date; ledger?: EventMailNoticeLedger; replies?: number } = {},
) => {
  const clients = new FakeClientRepository()
  const events = new FakeEventRepository({ clients })
  const users = new FakeUserRepository().seed(
    aUser({ id: HOST, email: 'hote@example.test' }),
    aUser({ id: CO_HOST, email: 'cohote@example.test' }),
    aUser({ id: MODERATOR, email: 'moderateur@example.test' }),
    aUser({ id: OFF_DUTY, email: 'parti@example.test', disabledAt: AT }),
  )
  const memberships = new FakeMembershipRepository({ users }).seed(
    { eventId: WEDDING, userId: HOST, role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: CO_HOST, role: 'owner', grantedAt: new Date(AT.getTime() + 1) },
    { eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT },
    { eventId: WEDDING, userId: OFF_DUTY, role: 'owner', grantedAt: AT },
  )
  const invites = new FakeGuestInviteRepository()
  const rsvps = new FakeGuestRsvpRepository()
  const ledger = new FakeEventMailNoticeLedger().withEvents(WEDDING)
  const budget = new FakeMailBudget()
  const mailer = new FakeMailer()
  const logger = new CapturingLogger()
  const clock = new FakeClock(options.now ?? NOW)

  const sweep = makeSweepRsvpNotices({
    events,
    clients,
    invites,
    rsvps,
    memberships,
    notices: options.ledger ?? ledger,
    budget,
    mailer: options.mailer ?? mailer,
    clock,
    logger,
    capNoticeDays: 30,
    publicUrl: 'https://photos.example.test',
  })

  /** Makes the event exist with its replies, and tells the replies repository its dates as the tables would. */
  const arrange = async (event: ReturnType<typeof anEvent>, replyCount = options.replies ?? 3) => {
    events.seed(event)
    rsvps.setEventDates(WEDDING, { closedAt: event.closedAt, startsAt: null })
    for (let i = 0; i < replyCount; i += 1) {
      rsvps.seed(
        aRsvp({ eventId: WEDDING, id: `rsvp-${i}`, name: 'Léa Martin', diet: 'sans gluten' }),
      )
    }
  }

  return {
    sweep,
    arrange,
    events,
    clients,
    invites,
    rsvps,
    ledger,
    budget,
    mailer,
    logger,
    clock,
    users,
    memberships,
  }
}

describe('sweepRsvpNotices', () => {
  it('writes the 7-day notice to the active owners, once each, and not to a moderator or a disabled account', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))

    const report = await world.sweep()

    expect(report).toMatchObject({ sent: 2, unsent: 0, failed: [] })
    expect(report.noticed).toEqual([{ eventId: WEDDING, level: 7 }])
    expect(world.mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'cohote@example.test',
      'hote@example.test',
    ])
  })

  it('says how many replies, which event, when, and where, and nothing of a guest', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))

    await world.sweep()

    const mail = world.mailer.sent[0]
    expect(mail?.subject).toContain('Camille et Sacha')
    expect(mail?.text).toContain('3 réponses')
    expect(mail?.text).toContain('https://photos.example.test/admin/events/camille-et-sacha/rsvps')
    expect(`${mail?.subject}\n${mail?.text}`).not.toMatch(/Léa|Martin|gluten/)
  })

  it('writes in the language of the client, else the wall language of the event', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7, { settings: { retentionDays: 365, wallLanguage: 'de' } }))

    await world.sweep()

    expect(world.mailer.sent[0]?.subject).toContain('Antworten')
  })

  it('uses the client language when the event has a client', async () => {
    const world = build()
    world.clients.seed(aClient({ id: 'client-1', locale: 'en' }))
    await world.arrange(closedGoingIn(7, { clientId: 'client-1' }))

    await world.sweep()

    expect(world.mailer.sent[0]?.subject).toContain('will be erased')
  })

  it('does not write twice for the same level, then writes the 1-day notice when it comes', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))
    await world.sweep()
    const afterFirst = world.mailer.sent.length

    await world.sweep()
    expect(world.mailer.sent).toHaveLength(afterFirst)

    world.clock.advance(6 * DAY)
    const report = await world.sweep()

    expect(report.noticed).toEqual([{ eventId: WEDDING, level: 1 }])
    expect(world.mailer.sent).toHaveLength(afterFirst * 2)

    await world.sweep()
    expect(world.mailer.sent).toHaveLength(afterFirst * 2)
  })

  it('says the replies go ON the day and to download the list the day before at the latest, in every language', async () => {
    for (const [locale, words] of [
      ['fr', 'la veille'],
      ['en', 'the day before'],
      ['de', 'Vortag'],
      ['es', 'día anterior'],
      ['it', 'giorno prima'],
    ] as const) {
      const world = build()
      world.clients.seed(aClient({ id: 'client-1', locale }))
      await world.arrange(closedGoingIn(7, { clientId: 'client-1' }))

      await world.sweep()

      expect(world.mailer.sent[0]?.text, locale).toContain(words)
      expect(world.mailer.sent[0]?.text, locale).not.toMatch(/avant cette date|before then/)
    }
  })

  it('dates a held event by its replies retention alone: its purge never runs, so it is not the date', async () => {
    const world = build()
    // Closed 30 days ago with a 20-day retention: the purge would be 10 days in the past, were it not held.
    await world.arrange(closedGoingIn(7, { settings: { retentionDays: 20 } }))
    await world.events.setPurgeHeld(WEDDING, new Date(NOW.getTime() - DAY))

    const report = await world.sweep()

    expect(report.noticed).toEqual([{ eventId: WEDDING, level: 7 }])
    expect(world.mailer.sent[0]?.subject).toContain('8 décembre 2026')
  })

  it('finds an event only by its replies retention, and another only by its purge', async () => {
    const world = build()
    const other = asEventId('evt-gala')
    world.ledger.withEvents(other)
    // WEDDING: replies go in 7 days, purge far away (found by retention only).
    await world.arrange(closedGoingIn(7))
    // GALA: closed 28 days ago, purge in 2 days, replies' retention in 2 days too, but listed on the purge side only.
    const gala = anEvent({
      id: other,
      slug: 'gala',
      joinCode: '2AB3CD',
      name: 'Gala',
      status: 'closed',
      closedAt: new Date(NOW.getTime() - 1 * DAY),
      settings: { retentionDays: 3 },
    })
    world.events.seed(gala)
    world.rsvps.seed(aRsvp({ eventId: other, id: 'gala-1' }))
    world.memberships.seed({ eventId: other, userId: HOST, role: 'owner', grantedAt: AT })

    const report = await world.sweep()

    expect(report.noticed.map((n) => n.eventId).sort()).toEqual([other, WEDDING].sort())
  })

  it('ignores a purge date more than 7 days in the past without reading the event any further', async () => {
    const world = build()
    const old = anEvent({
      id: WEDDING,
      status: 'closed',
      closedAt: new Date(NOW.getTime() - 40 * DAY),
      settings: { retentionDays: 3 },
    })
    world.events.seed(old)
    let hydrated = 0
    const findById = world.events.findById.bind(world.events)
    world.events.findById = async (id) => {
      hydrated += 1
      return findById(id)
    }

    const report = await world.sweep()

    expect(report).toEqual({ noticed: [], sent: 0, unsent: 0, failed: [] })
    expect(hydrated).toBe(0)
  })

  it('dates a client event by its client ceilings when it is found by its purge', async () => {
    const world = build()
    world.clients.seed(aClient({ id: 'client-1', locale: 'en' }))
    await world.arrange(
      closedGoingIn(25, {
        clientId: 'client-1',
        settings: { retentionDays: 3 },
        closedAt: new Date(NOW.getTime() - DAY),
      }),
    )

    const report = await world.sweep()

    expect(report.noticed).toEqual([{ eventId: WEDDING, level: 7 }])
    expect(world.mailer.sent[0]?.subject).toContain('December 3, 2026')
  })

  it('skips a listed event that has no purge date at all', async () => {
    const world = build()
    const live = anEvent({ id: WEDDING, status: 'live' })
    const sweep = makeSweepRsvpNotices({
      events: { listDueForPurge: async () => [live], findById: async () => live },
      clients: world.clients,
      invites: world.invites,
      rsvps: { count: async () => 1, eventsWithRepliesExpiringBefore: async () => [] },
      memberships: world.memberships,
      notices: world.ledger,
      budget: world.budget,
      mailer: world.mailer,
      clock: world.clock,
      logger: world.logger,
      capNoticeDays: 30,
      publicUrl: 'https://photos.example.test',
    })

    expect(await sweep()).toEqual({ noticed: [], sent: 0, unsent: 0, failed: [] })
  })

  it('warns for an event that never closed, whose replies go 60 days after the invitation starts', async () => {
    const world = build()
    const starts = new Date(NOW.getTime() - 53 * DAY)
    const live = anEvent({
      id: WEDDING,
      slug: 'camille-et-sacha',
      joinCode: 'H7K2QM',
      name: 'Camille et Sacha',
      status: 'live',
    })
    world.events.seed(live)
    world.rsvps.setEventDates(WEDDING, { closedAt: null, startsAt: starts })
    world.rsvps.seed(aRsvp({ eventId: WEDDING, id: 'r-1' }))
    world.invites.seed(
      aGuestInvite({ eventId: WEDDING, startsAt: starts.toISOString(), timeZone: 'Europe/Paris' }),
    )

    const report = await world.sweep()

    expect(report.noticed).toEqual([{ eventId: WEDDING, level: 7 }])
  })

  it('writes the 1-day notice to an owner who joined between the two levels', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))
    await world.sweep()
    const joiner = asUserId('user-new')
    world.users.seed(aUser({ id: joiner, email: 'nouveau@example.test' }))
    world.memberships.seed({ eventId: WEDDING, userId: joiner, role: 'owner', grantedAt: AT })

    world.clock.advance(6 * DAY)
    await world.sweep()

    const toNewcomer = world.mailer.sent.filter((mail) => mail.to === 'nouveau@example.test')
    expect(toNewcomer).toHaveLength(1)
  })

  it('sends the 1-day notice the evening before when the erasure is at 06:00 local', async () => {
    // Replies go on 8 December at 06:00 in Paris (05:00 UTC). Any 24 hours hold a 13-hour sending window
    // (08:00 to 21:00), so the 1-day level cannot be skipped unless the sweep itself is stopped.
    const erasure = new Date('2026-12-08T05:00:00.000Z')
    const world = build({ now: new Date('2026-12-01T12:00:00.000Z') })
    await world.arrange(closedGoingIn(7, { closedAt: new Date(erasure.getTime() - 30 * DAY) }))
    await world.sweep()
    const afterSeven = world.mailer.sent.length

    // 21:30 the evening before: night, nothing leaves.
    world.clock.advance(6 * DAY + 9.5 * 3_600_000)
    expect((await world.sweep()).noticed).toEqual([])

    // 08:00 the day before at the very latest... here the afternoon of the 7th (13:00 local).
    world.clock.set(new Date('2026-12-07T12:00:00.000Z'))
    expect((await world.sweep()).noticed).toEqual([{ eventId: WEDDING, level: 1 }])
    expect(world.mailer.sent.length).toBeGreaterThan(afterSeven)
  })

  it('owes nothing with more than 7 days left', async () => {
    const world = build()
    await world.arrange(closedGoingIn(8))

    expect(await world.sweep()).toMatchObject({ noticed: [], sent: 0 })
  })

  it('owes nothing for replies whose date has already arrived, and notes nothing: first run on an old base', async () => {
    const world = build()
    await world.arrange(closedGoingIn(-3))

    const report = await world.sweep()

    expect(report).toMatchObject({ noticed: [], sent: 0 })
    expect(world.ledger.noted).toEqual([])
    expect(world.mailer.sent).toEqual([])
  })

  it('owes nothing for an event that has no clock running, nor one whose replies were all deleted since it was listed', async () => {
    const world = build()
    world.events.seed(anEvent({ id: WEDDING, status: 'live' }))
    const sweepOver = (count: number) =>
      makeSweepRsvpNotices({
        events: world.events,
        clients: world.clients,
        invites: world.invites,
        rsvps: { count: async () => count, eventsWithRepliesExpiringBefore: async () => [WEDDING] },
        memberships: { ownersToNotify: async () => [] },
        notices: world.ledger,
        budget: world.budget,
        mailer: world.mailer,
        clock: world.clock,
        logger: world.logger,
        capNoticeDays: 30,
        publicUrl: 'https://photos.example.test',
      })

    expect(await sweepOver(5)()).toMatchObject({ noticed: [], sent: 0 })

    world.events.seed(closedGoingIn(7))
    expect(await sweepOver(0)()).toMatchObject({ noticed: [], sent: 0 })
  })

  it('owes nothing for an event with no reply', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7), 0)

    expect(await world.sweep()).toMatchObject({ noticed: [], sent: 0 })
  })

  it('takes the purge date when the album goes before the replies do', async () => {
    const world = build()
    // Closed 28 days ago with a retention of 30: the album goes in 2 days, the replies' own 30 days in 2 as well; use 3 days of retention.
    await world.arrange(
      closedGoingIn(25, {
        settings: { retentionDays: 3 },
        closedAt: new Date(NOW.getTime() - 1 * DAY),
      }),
    )

    const report = await world.sweep()

    expect(report.noticed).toEqual([{ eventId: WEDDING, level: 7 }])
    expect(world.mailer.sent[0]?.subject).toContain('3 décembre 2026')
  })

  it('writes the levels again for a date that moved: reopened, closed again later', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))
    await world.sweep()
    const first = world.mailer.sent.length

    // Reopened and closed again: the replies' 30 days now end 6 days from now.
    world.events.seed(closedGoingIn(6, { closedAt: new Date(NOW.getTime() - 24 * DAY) }))
    world.rsvps.setEventDates(WEDDING, {
      closedAt: new Date(NOW.getTime() - 24 * DAY),
      startsAt: null,
    })
    await world.sweep()

    expect(world.mailer.sent.length).toBeGreaterThan(first)
  })

  it('writes to every owner whatever their e-mail switches say: no family, no switch', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))

    await world.sweep()

    expect(world.mailer.sent).toHaveLength(2)
  })

  it('sends nothing and notes nothing without a relay, so no notice is skipped the day one is set', async () => {
    const world = build({
      mailer: { canDeliver: false, send: async () => ({ ok: true, value: undefined }) },
    })
    await world.arrange(closedGoingIn(7))

    const report = await world.sweep()

    expect(report).toEqual({ noticed: [], sent: 0, unsent: 0, failed: [] })
    expect(world.ledger.noted).toEqual([])
  })

  it('waits for the morning outside 08:00 to 21:00 where the party is, and notes nothing', async () => {
    const world = build({ now: new Date('2026-12-01T03:00:00.000Z') })
    await world.arrange(closedGoingIn(7))

    const report = await world.sweep()

    expect(report.noticed).toEqual([])
    expect(world.ledger.noted).toEqual([])
  })

  it('reads the hour in the invitation zone, not in Paris', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))
    // 13:00 in Paris is 01:00 the next day in Auckland.
    world.invites.seed(
      aGuestInvite({
        eventId: WEDDING,
        startsAt: '2027-06-01T10:00:00.000Z',
        timeZone: 'Pacific/Auckland',
      }),
    )

    expect((await world.sweep()).noticed).toEqual([])
  })

  it.each([
    [
      'taken down by the operator',
      async (w: ReturnType<typeof build>) => w.events.setTakenDown(WEDDING, AT),
    ],
  ])('writes nothing for an event %s', async (_name, arrange) => {
    const world = build()
    await world.arrange(closedGoingIn(7))
    await arrange(world)

    expect((await world.sweep()).noticed).toEqual([])
  })

  it('writes nothing for an event whose client is suspended, or is being closed', async () => {
    const suspended = build()
    suspended.clients.seed(aClient({ id: 'client-1', suspendedAt: AT }))
    await suspended.arrange(closedGoingIn(7, { clientId: 'client-1', clientSuspendedAt: AT }))
    expect((await suspended.sweep()).noticed).toEqual([])

    const closing = build()
    closing.clients.seed(aClient({ id: 'client-1', purgeAfter: new Date(NOW.getTime() + 3 * DAY) }))
    await closing.arrange(closedGoingIn(7, { clientId: 'client-1' }))
    expect((await closing.sweep()).noticed).toEqual([])
  })

  it('still covers an archived event: its clock runs, its replies go', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7, { status: 'archived' }))

    expect((await world.sweep()).noticed).toEqual([{ eventId: WEDDING, level: 7 }])
  })

  it('notes the notice before it sends: a note another sweep placed first means no mail from this one', async () => {
    const taken: EventMailNoticeLedger = {
      note: async () => false,
      has: async () => false,
    }
    const world = build({ ledger: taken })
    await world.arrange(closedGoingIn(7))

    const report = await world.sweep()

    expect(report).toMatchObject({ noticed: [], sent: 0 })
    expect(world.mailer.sent).toEqual([])
  })

  it('has the note in the ledger when the first mail goes out', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))
    let notedAtSend = false
    const send = world.mailer.send.bind(world.mailer)
    world.mailer.send = async (mail) => {
      notedAtSend = world.ledger.noted.length === 1
      return send(mail)
    }

    await world.sweep()

    expect(notedAtSend).toBe(true)
  })

  it('counts its mails in the day budget, without being refused by it', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))

    await world.sweep()

    expect(await world.budget.used('2026-12-01')).toBe(2)
  })

  it('notes the notice without a mail when no owner can be written to', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))
    world.users.seed(
      aUser({ id: HOST, email: 'hote@example.test', disabledAt: AT }),
      aUser({ id: CO_HOST, email: 'cohote@example.test', disabledAt: AT }),
    )

    const report = await world.sweep()

    expect(report).toMatchObject({ noticed: [{ eventId: WEDDING, level: 7 }], sent: 0 })
  })

  it('counts a refused message as unsent, logs the code and never the address, and does not retry', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))
    world.mailer.failNextWith('rejected')

    const report = await world.sweep()

    expect(report).toMatchObject({ sent: 1, unsent: 1 })
    const logged = JSON.stringify(world.logger.lines)
    expect(logged).toContain('a replies erasure notice was not sent')
    expect(logged).not.toContain('example.test')
    await world.sweep()
    expect(world.mailer.sent).toHaveLength(1)
  })

  it('counts an owner whose stored address is not an address as unsent', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))
    const broken = makeSweepRsvpNotices({
      events: world.events,
      clients: world.clients,
      invites: world.invites,
      rsvps: world.rsvps,
      memberships: {
        ownersToNotify: async () => [
          {
            userId: HOST,
            email: 'not an address',
            mail: { rsvp: true, event: true },
            rsvpDigest: false,
            rsvpDigestAt: null,
          },
        ],
      },
      notices: world.ledger,
      budget: world.budget,
      mailer: world.mailer,
      clock: world.clock,
      logger: world.logger,
      capNoticeDays: 30,
      publicUrl: 'https://photos.example.test',
    })

    expect(await broken()).toMatchObject({ sent: 0, unsent: 1 })
  })

  it('lists the failure and goes on when one event cannot be examined', async () => {
    const world = build()
    await world.arrange(closedGoingIn(7))
    const failing = makeSweepRsvpNotices({
      events: {
        listDueForPurge: async () => [],
        findById: async () => {
          throw new Error('database is locked')
        },
      },
      clients: world.clients,
      invites: world.invites,
      rsvps: world.rsvps,
      memberships: { ownersToNotify: async () => [] },
      notices: world.ledger,
      budget: world.budget,
      mailer: world.mailer,
      clock: world.clock,
      logger: world.logger,
      capNoticeDays: 30,
      publicUrl: 'https://photos.example.test',
    })

    expect((await failing()).failed).toEqual([WEDDING])
  })

  it('never throws when the candidates cannot be listed', async () => {
    const world = build()
    const failing = makeSweepRsvpNotices({
      events: {
        listDueForPurge: async () => {
          throw new Error('database is locked')
        },
        findById: async () => null,
      },
      clients: world.clients,
      invites: world.invites,
      rsvps: world.rsvps,
      memberships: { ownersToNotify: async () => [] },
      notices: world.ledger,
      budget: world.budget,
      mailer: world.mailer,
      clock: world.clock,
      logger: world.logger,
      capNoticeDays: 30,
      publicUrl: 'https://photos.example.test',
    })

    expect(await failing()).toEqual({ noticed: [], sent: 0, unsent: 0, failed: [] })
    expect(JSON.stringify(world.logger.lines)).toContain('could not list')
  })

  it('logs a failure that is not an Error as text, and skips an event that is gone', async () => {
    const world = build()
    const sweep = makeSweepRsvpNotices({
      events: {
        listDueForPurge: async () => {
          throw 'plain'
        },
        findById: async () => null,
      },
      clients: world.clients,
      invites: world.invites,
      rsvps: { count: async () => 0, eventsWithRepliesExpiringBefore: async () => [WEDDING] },
      memberships: { ownersToNotify: async () => [] },
      notices: world.ledger,
      budget: world.budget,
      mailer: world.mailer,
      clock: world.clock,
      logger: world.logger,
      capNoticeDays: 30,
      publicUrl: 'https://photos.example.test',
    })
    await sweep()

    const gone = makeSweepRsvpNotices({
      events: { listDueForPurge: async () => [], findById: async () => null },
      clients: world.clients,
      invites: world.invites,
      rsvps: { count: async () => 1, eventsWithRepliesExpiringBefore: async () => [WEDDING] },
      memberships: { ownersToNotify: async () => [] },
      notices: world.ledger,
      budget: world.budget,
      mailer: world.mailer,
      clock: world.clock,
      logger: world.logger,
      capNoticeDays: 30,
      publicUrl: 'https://photos.example.test',
    })
    expect(await gone()).toEqual({ noticed: [], sent: 0, unsent: 0, failed: [] })
  })

  it('gives an unknown mail failure to the report as unsent too', async () => {
    const world = build({
      mailer: {
        canDeliver: true,
        send: async () => err(mailFailure('transient')),
      },
    })
    await world.arrange(closedGoingIn(7))

    expect(await world.sweep()).toMatchObject({ sent: 0, unsent: 2 })
  })
})
