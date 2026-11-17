import { describe, expect, it } from 'vitest'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { err, ok } from '../../../domain/shared/result'
import { AT, aClient, anEvent, aUser } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMailer } from '../../testing/fakeMailer'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakePurgeNoticeLedger } from '../../testing/fakePurgeNoticeLedger'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { mailFailure, type Mailer } from '../../ports/mailer'
import { makeSweepPurgeNotices } from './sweepPurgeNotices'

/**
 * Spec 22, the warning before a purge. Every case is stated in days from `NOW`: "the album goes
 * in 14 days" is the sentence the host is told.
 */

const DAY = 86_400_000
const NOW = new Date('2026-12-01T12:00:00.000Z')
const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const HOST = asUserId('user-host')
const CO_HOST = asUserId('user-cohost')
const MODERATOR = asUserId('user-mod')

/** A closed event that goes `inDays` days after NOW, through its host's own retention of 30 days. */
const closedGoingIn = (id: string, inDays: number, extra: Parameters<typeof anEvent>[0] = {}) =>
  anEvent({
    id,
    slug: id,
    joinCode: id === 'evt-wedding' ? 'H7K2QM' : '2AB3CD',
    name: id === 'evt-wedding' ? 'Camille et Sacha' : 'Gala',
    status: 'closed',
    closedAt: new Date(NOW.getTime() + (inDays - 30) * DAY),
    settings: { retentionDays: 30 },
    ...extra,
  })

const build = (options: { mailer?: Mailer } = {}) => {
  const clients = new FakeClientRepository()
  const events = new FakeEventRepository({ clients })
  const users = new FakeUserRepository()
  const memberships = new FakeMembershipRepository({ users })
  users.seed(
    aUser({ id: HOST, email: 'hote@example.test' }),
    aUser({ id: CO_HOST, email: 'cohote@example.test' }),
    aUser({ id: MODERATOR, email: 'moderateur@example.test' }),
  )
  const notices = new FakePurgeNoticeLedger().withEvents(WEDDING, GALA)
  const mailer = new FakeMailer()
  const logger = new CapturingLogger()
  const clock = new FakeClock(NOW)
  const sweep = makeSweepPurgeNotices({
    events,
    clients,
    memberships,
    notices,
    mailer: options.mailer ?? mailer,
    clock,
    logger,
    capNoticeDays: 30,
    publicUrl: 'https://photos.example.com',
  })
  const owns = (eventId: string, ...owners: (typeof HOST)[]) =>
    memberships.seed(
      ...owners.map((userId) => ({
        eventId: asEventId(eventId),
        userId,
        role: 'owner' as const,
        grantedAt: AT,
      })),
    )
  return { sweep, events, clients, memberships, notices, mailer, logger, clock, owns }
}

describe('makeSweepPurgeNotices', () => {
  it('writes to the owners of an album 14 days before it goes, once', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 14))
    world.owns('evt-wedding', HOST)

    const report = await world.sweep()

    expect(world.mailer.sent.map((mail) => mail.to)).toEqual(['hote@example.test'])
    expect(report.noticed).toEqual([{ eventId: WEDDING, level: 14 }])
    expect(report.sent).toBe(1)
  })

  it('says in the subject which album goes and on which day, and where to download it', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 14))
    world.owns('evt-wedding', HOST)

    await world.sweep()

    const [mail] = world.mailer.sent
    expect(mail?.subject).toBe('Votre album « Camille et Sacha » sera supprimé le 15 décembre 2026')
    expect(mail?.text).toContain('https://photos.example.com/admin/events/evt-wedding')
  })

  it('writes to every owner and to no moderator', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 3))
    world.owns('evt-wedding', HOST, CO_HOST)
    world.memberships.seed({
      eventId: WEDDING,
      userId: MODERATOR,
      role: 'moderator',
      grantedAt: AT,
    })

    await world.sweep()

    expect(world.mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'cohote@example.test',
      'hote@example.test',
    ])
  })

  it('does not write again on the next tick for a threshold already sent', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 14))
    world.owns('evt-wedding', HOST)

    await world.sweep()
    await world.sweep()

    expect(world.mailer.sent).toHaveLength(1)
  })

  it('writes again when the album has come within the next threshold', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 14))
    world.owns('evt-wedding', HOST)

    await world.sweep()
    world.clock.advance(11 * DAY)
    await world.sweep()
    world.clock.advance(2 * DAY)
    await world.sweep()

    expect(world.notices.noted.map((note) => note.level)).toEqual([14, 3, 1])
    expect(world.mailer.sent).toHaveLength(3)
  })

  it('owes every threshold again when the deadline moves later after the 1-day notice', async () => {
    // Reopened and closed again: the old ledger row (1) describes a date that is gone.
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 1))
    world.owns('evt-wedding', HOST)
    await world.sweep()
    expect(world.notices.noted.map((note) => note.level)).toEqual([1])

    world.events.seed(closedGoingIn('evt-wedding', 14, { id: 'evt-wedding' }))
    const report = await world.sweep()

    expect(report.noticed).toEqual([{ eventId: WEDDING, level: 14 }])
    expect(world.mailer.sent).toHaveLength(2)
    await world.sweep()
    expect(world.mailer.sent).toHaveLength(2)
  })

  it('writes nothing to an album that has more than 14 days left', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 15))
    world.owns('evt-wedding', HOST)

    await world.sweep()

    expect(world.mailer.sent).toEqual([])
    expect(world.notices.noted).toEqual([])
  })

  it('sends only the most urgent threshold when the date shows up late, not the ones it has passed', async () => {
    // A retention of a few days: the date exists for the first time with 2 days left.
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 2))
    world.owns('evt-wedding', HOST)

    await world.sweep()
    await world.sweep()

    expect(world.notices.noted.map((note) => note.level)).toEqual([3])
    expect(world.mailer.sent).toHaveLength(1)
  })

  it('sends the 1-day notice, alone, for an album that goes tomorrow', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 1))
    world.owns('evt-wedding', HOST)

    await world.sweep()

    expect(world.notices.noted.map((note) => note.level)).toEqual([1])
  })

  it('writes nothing for an album whose date has already come: that is the purge business, not a warning', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 0))
    world.owns('evt-wedding', HOST)

    await world.sweep()

    expect(world.mailer.sent).toEqual([])
  })

  it('notes the threshold before it hands the message to the relay, so a crash cannot send it twice', async () => {
    const seen: { levelWhenSending: number | null | undefined } = { levelWhenSending: undefined }
    const holder: { notices?: FakePurgeNoticeLedger } = {}
    const spying: Mailer = {
      canDeliver: true,
      send: async () => {
        // At the moment the relay is handed the message, the ledger must already hold the threshold.
        seen.levelWhenSending = await holder.notices?.lastLevel(WEDDING)
        return ok(undefined)
      },
    }
    const world = build({ mailer: spying })
    holder.notices = world.notices
    world.events.seed(closedGoingIn('evt-wedding', 14))
    world.owns('evt-wedding', HOST)

    await world.sweep()

    expect(seen.levelWhenSending).toBe(14)
  })

  it('does not send the same threshold again after a crash between the note and the send', async () => {
    const crashing: Mailer = {
      canDeliver: true,
      send: async () => {
        throw new Error('the process was killed here')
      },
    }
    const world = build({ mailer: crashing })
    world.events.seed(closedGoingIn('evt-wedding', 14))
    world.owns('evt-wedding', HOST)

    const first = await world.sweep()
    const second = await world.sweep()

    expect(first.failed).toEqual([WEDDING])
    expect(second.noticed).toEqual([])
    expect(await world.notices.lastLevel(WEDDING)).toBe(14)
  })

  it('counts a message the relay refused, notes it all the same and does not retry it', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 14))
    world.owns('evt-wedding', HOST)
    world.mailer.failNextWith('transient')

    const first = await world.sweep()
    const second = await world.sweep()

    expect(first.unsent).toBe(1)
    expect(first.sent).toBe(0)
    expect(second.noticed).toEqual([])
    expect(world.mailer.sent).toEqual([])
    expect(world.logger.lines.map((line) => line.level)).toEqual(['warn'])
  })

  it('sends and notes nothing without a relay, so a later SMTP does not skip a warning', async () => {
    // What `NullMailer` is: it cannot deliver, and would answer `mail.notConfigured` to a send.
    let attempts = 0
    const noRelay: Mailer = {
      canDeliver: false,
      send: async () => {
        attempts += 1
        return err(mailFailure('notConfigured'))
      },
    }
    const world = build({ mailer: noRelay })
    world.events.seed(closedGoingIn('evt-wedding', 14))
    world.owns('evt-wedding', HOST)

    const report = await world.sweep()

    expect(report).toEqual({ noticed: [], sent: 0, unsent: 0, failed: [] })
    expect(world.notices.noted).toEqual([])
    expect(attempts).toBe(0)
  })

  it('never writes about an album the operator holds, whatever its date', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 3))
    world.owns('evt-wedding', HOST)
    await world.events.setPurgeHeld(WEDDING, AT)

    await world.sweep()

    expect(world.mailer.sent).toEqual([])
    expect(world.notices.noted).toEqual([])
  })

  it('never writes about an album with no date: kept until a person deletes it', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 3, { settings: { retentionDays: null } }))
    world.owns('evt-wedding', HOST)

    await world.sweep()

    expect(world.mailer.sent).toEqual([])
    expect(world.notices.noted).toEqual([])
  })

  it('never writes about an event that is still running', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 3, { status: 'live', closedAt: null }))
    world.owns('evt-wedding', HOST)

    await world.sweep()

    expect(world.mailer.sent).toEqual([])
  })

  it('warns about an album that goes with its client, on the date of the client offboarding', async () => {
    const world = build()
    const client = aClient({
      id: 'client-1',
      suspendedAt: AT,
      purgeAfter: new Date(NOW.getTime() + 2 * DAY),
    })
    world.clients.seed(client)
    world.events.seed(
      closedGoingIn('evt-wedding', 90, { clientId: 'client-1', settings: { retentionDays: 120 } }),
    )
    world.owns('evt-wedding', HOST)

    await world.sweep()

    expect(world.notices.noted.map((note) => note.level)).toEqual([3])
    expect(client.id).toBe(asClientId('client-1'))
  })

  it('writes in the language of the client when the event has one', async () => {
    const world = build()
    world.clients.seed(aClient({ id: 'client-1', locale: 'en' }))
    world.events.seed(closedGoingIn('evt-wedding', 14, { clientId: 'client-1' }))
    world.owns('evt-wedding', HOST)

    await world.sweep()

    expect(world.mailer.sent[0]?.subject).toBe(
      'Your album "Camille et Sacha" will be deleted on December 15, 2026',
    )
  })

  it('writes in the wall language of the event when it has no client', async () => {
    const world = build()
    world.events.seed(
      closedGoingIn('evt-wedding', 14, { settings: { retentionDays: 30, wallLanguage: 'de' } }),
    )
    world.owns('evt-wedding', HOST)

    await world.sweep()

    expect(world.mailer.sent[0]?.subject).toBe(
      'Ihr Album „Camille et Sacha“ wird am 15. Dezember 2026 gelöscht',
    )
  })

  it('treats each album on its own, so one at 14 days and one at 1 day get their own thresholds', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 14), closedGoingIn('evt-gala', 1))
    world.owns('evt-wedding', HOST)
    world.owns('evt-gala', CO_HOST)

    const report = await world.sweep()

    expect([...report.noticed].sort((a, b) => a.level - b.level)).toEqual([
      { eventId: GALA, level: 1 },
      { eventId: WEDDING, level: 14 },
    ])
  })

  it('counts an owner whose stored address is not an address as unsent, and writes to the others', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 14))
    const sweep = makeSweepPurgeNotices({
      events: world.events,
      clients: world.clients,
      memberships: {
        listForEvent: async () => [
          {
            eventId: WEDDING,
            userId: HOST,
            role: 'owner',
            grantedAt: AT,
            email: 'not an address',
            displayName: null,
          },
          {
            eventId: WEDDING,
            userId: CO_HOST,
            role: 'owner',
            grantedAt: AT,
            email: 'cohote@example.test',
            displayName: null,
          },
        ],
      },
      notices: world.notices,
      mailer: world.mailer,
      clock: world.clock,
      logger: world.logger,
      capNoticeDays: 30,
      publicUrl: 'https://photos.example.com',
    })

    const report = await sweep()

    expect(world.mailer.sent.map((mail) => mail.to)).toEqual(['cohote@example.test'])
    expect([report.sent, report.unsent]).toEqual([1, 1])
  })

  it('writes about nothing the listing should not have returned: an event with no date of its own', async () => {
    // The listing is the first guard; this is the second. A live event has no deadline at all.
    const world = build()
    const live = anEvent({ id: 'evt-wedding', slug: 'evt-wedding', status: 'live' })
    const sweep = makeSweepPurgeNotices({
      events: { listDueForPurge: async () => [live] },
      clients: world.clients,
      memberships: world.memberships,
      notices: world.notices,
      mailer: world.mailer,
      clock: world.clock,
      logger: world.logger,
      capNoticeDays: 30,
      publicUrl: 'https://photos.example.com',
    })

    const report = await sweep()

    expect(report).toEqual({ noticed: [], sent: 0, unsent: 0, failed: [] })
    expect(world.notices.noted).toEqual([])
  })

  it('keeps going when one album cannot be examined, and says which', async () => {
    const world = build()
    world.events.seed(closedGoingIn('evt-wedding', 14), closedGoingIn('evt-gala', 14))
    world.owns('evt-gala', HOST)
    const failing = new FakePurgeNoticeLedger().withEvents(WEDDING, GALA)
    const original = failing.lastLevel.bind(failing)
    failing.lastLevel = async (eventId) => {
      if (eventId === WEDDING) throw new Error('database is locked')
      return original(eventId)
    }
    const sweep = makeSweepPurgeNotices({
      events: world.events,
      clients: world.clients,
      memberships: world.memberships,
      notices: failing,
      mailer: world.mailer,
      clock: world.clock,
      logger: world.logger,
      capNoticeDays: 30,
      publicUrl: 'https://photos.example.com',
    })

    const report = await sweep()

    expect(report.failed).toEqual([WEDDING])
    expect(report.noticed).toEqual([{ eventId: GALA, level: 14 }])
  })

  it('never throws when the listing itself fails: it logs and reports nothing', async () => {
    const world = build()
    const sweep = makeSweepPurgeNotices({
      events: {
        listDueForPurge: async () => {
          throw new Error('database is closed')
        },
      },
      clients: world.clients,
      memberships: world.memberships,
      notices: world.notices,
      mailer: world.mailer,
      clock: world.clock,
      logger: world.logger,
      capNoticeDays: 30,
      publicUrl: 'https://photos.example.com',
    })

    await expect(sweep()).resolves.toEqual({ noticed: [], sent: 0, unsent: 0, failed: [] })
    expect(world.logger.lines.map((line) => line.level)).toEqual(['error'])
  })

  it('logs the listing failure whatever was thrown', async () => {
    const world = build()
    const sweep = makeSweepPurgeNotices({
      events: {
        listDueForPurge: async () => {
          throw 'plain string'
        },
      },
      clients: world.clients,
      memberships: world.memberships,
      notices: world.notices,
      mailer: world.mailer,
      clock: world.clock,
      logger: world.logger,
      capNoticeDays: 30,
      publicUrl: 'https://photos.example.com',
    })

    await sweep()

    expect(world.logger.lines[0]?.context).toMatchObject({ error: 'plain string' })
  })
})
