import { describe, expect, it } from 'vitest'
import { aHousehold } from '../../../domain/guestRsvps/testing/householdFixtures'
import { aRsvp } from '../../../domain/guestRsvps/testing/rsvpFixtures'
import { DEFAULT_RSVP_FORM } from '../../../domain/guestRsvps/rsvpForm'
import { DEFAULT_RSVP_SETTINGS, type RsvpSettings } from '../../../domain/guestRsvps/rsvpSettings'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aGuestInvite, anEvent, aUser } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventMailNoticeLedger } from '../../testing/fakeEventMailNoticeLedger'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestHouseholdRepository } from '../../testing/fakeGuestHouseholdRepository'
import { FakeGuestInviteRepository } from '../../testing/fakeGuestInviteRepository'
import { FakeGuestRsvpRepository } from '../../testing/fakeGuestRsvpRepository'
import { FakeMailBudget } from '../../testing/fakeMailBudget'
import { FakeMailPreferenceRepository } from '../../testing/fakeMailPreferenceRepository'
import { FakeMailer } from '../../testing/fakeMailer'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeSweepRsvpNotices } from './sweepRsvpNotices'

/**
 * R3, R4 and R5 (spec 32, section 3.1), through the sweep: the deadline reminder, the summary after the deadline
 * stopped the replies, and the full house. The party is on 13 December at 19:00 in Paris, replies are asked until
 * 5 December (they stop at 23:00 UTC that day), and the host and a co-host own the event.
 */

const WEDDING = asEventId('evt-wedding')
const HOST = asUserId('user-host')
const CO_HOST = asUserId('user-cohost')
const NOON_3RD = new Date('2026-12-03T12:00:00.000Z')

const settings = (patch: Partial<RsvpSettings> = {}): RsvpSettings => ({
  ...DEFAULT_RSVP_SETTINGS,
  enabled: true,
  deadline: '2026-12-05',
  form: { ...DEFAULT_RSVP_FORM, meals: { enabled: true, options: ['Poisson', 'Végé'] } },
  ...patch,
})

const build = async (
  options: {
    now?: Date
    settings?: RsvpSettings
    households?: number
    answered?: number
    people?: number
    hostMailNotices?: boolean
    budgetMax?: number | null
  } = {},
) => {
  const clients = new FakeClientRepository()
  const events = new FakeEventRepository({ clients })
  const users = new FakeUserRepository().seed(
    aUser({ id: HOST, email: 'hote@example.test' }),
    aUser({ id: CO_HOST, email: 'cohote@example.test' }),
  )
  const preferences = new FakeMailPreferenceRepository()
    .withUsers(HOST, CO_HOST)
    .withMembers({ eventId: WEDDING, userId: HOST }, { eventId: WEDDING, userId: CO_HOST })
  const memberships = new FakeMembershipRepository({ users, mailPreferences: preferences }).seed(
    { eventId: WEDDING, userId: HOST, role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: CO_HOST, role: 'owner', grantedAt: new Date(AT.getTime() + 1) },
  )
  const invites = new FakeGuestInviteRepository()
  const rsvps = new FakeGuestRsvpRepository()
  const households = new FakeGuestHouseholdRepository()
  const ledger = new FakeEventMailNoticeLedger().withEvents(WEDDING)
  const budget = new FakeMailBudget(options.budgetMax ?? null)
  const mailer = new FakeMailer()
  const logger = new CapturingLogger()
  const clock = new FakeClock(options.now ?? NOON_3RD)

  events.seed(
    anEvent({
      id: WEDDING,
      slug: 'camille-et-sacha',
      joinCode: 'H7K2QM',
      name: 'Camille et Sacha',
      status: 'live',
    }),
  )
  await invites.create(
    aGuestInvite({
      eventId: WEDDING,
      enabled: true,
      startsAt: '2026-12-13T18:00:00.000Z',
      timeZone: 'Europe/Paris',
    }),
  )
  const held = options.settings ?? settings()
  await invites.saveRsvpSettings(WEDDING, held)
  if (held.closedAt !== null) await invites.setRsvpClosedAt(WEDDING, held.closedAt)
  rsvps.setEventDates(WEDDING, {
    closedAt: null,
    startsAt: new Date('2026-12-13T18:00:00.000Z'),
  })

  const totalHouseholds = options.households ?? 0
  const tokens = ['7QX0M4TZ2KD9WB3H', 'QX0M4TZ2KD9WB3H7', 'X0M4TZ2KD9WB3H7Q', '0M4TZ2KD9WB3H7QX']
  for (let i = 0; i < totalHouseholds; i += 1) {
    households.seed(
      aHousehold({
        id: `h-${i}`,
        eventId: WEDDING,
        token: tokens[i] ?? '7QX0M4TZ2KD9WB3H',
        name: `Foyer ${i}`,
      }),
    )
  }
  const answered = options.answered ?? 0
  for (let i = 0; i < answered; i += 1) {
    rsvps.seed(
      aRsvp({
        id: `r-${i}`,
        eventId: WEDDING,
        householdId: `h-${i}`,
        name: 'Léa Martin',
        diet: 'sans gluten',
        message: 'Merci beaucoup',
        details: { meals: ['Poisson', 'Texte libre de Léa'], companions: ['Hugo'] },
        adults: options.people ?? 2,
        kids: 0,
        updatedAt: new Date((options.now ?? NOON_3RD).getTime() - 3_600_000),
      }),
    )
  }

  const deps = {
    events,
    clients,
    invites,
    rsvps,
    households,
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
  const sweep = makeSweepRsvpNotices(deps)
  return { sweep, mailer, ledger, budget, clock, preferences, invites, rsvps, logger, deps }
}

const subjects = (world: Awaited<ReturnType<typeof build>>): string[] =>
  world.mailer.sent.map((mail) => mail.subject)

describe('R3, the deadline reminder', () => {
  it('writes to the owners three days before the deadline, with the number of households and the unanswered list', async () => {
    const world = await build({ households: 3, answered: 1 })

    const report = await world.sweep()

    expect(report.noticed).toEqual([{ eventId: WEDDING, kind: 'rsvpDeadline' }])
    expect(world.mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'cohote@example.test',
      'hote@example.test',
    ])
    expect(world.mailer.sent[0]?.text).toContain('2 foyers sans réponse')
    expect(world.mailer.sent[0]?.text).toContain('5 décembre 2026')
    expect(world.mailer.sent[0]?.text).toContain('/rsvps/guests?filter=unanswered')
  })

  it('writes once: the next pass finds it noted', async () => {
    const world = await build({ households: 3, answered: 1 })
    await world.sweep()
    const first = world.mailer.sent.length

    await world.sweep()

    expect(world.mailer.sent).toHaveLength(first)
  })

  it('owes nothing earlier than three days before, nor when every household answered, nor without a guest list', async () => {
    const early = await build({
      households: 3,
      answered: 1,
      now: new Date('2026-12-01T12:00:00.000Z'),
    })
    expect((await early.sweep()).noticed).toEqual([])

    const answered = await build({ households: 2, answered: 2 })
    expect((await answered.sweep()).noticed).toEqual([])

    const none = await build({ households: 0 })
    expect((await none.sweep()).noticed).toEqual([])
  })

  it('waits for the morning, and notes nothing, at night in the zone of the invitation', async () => {
    const world = await build({
      households: 3,
      answered: 1,
      now: new Date('2026-12-03T03:00:00.000Z'),
    })

    expect(await world.sweep()).toMatchObject({ noticed: [], sent: 0 })
    expect(world.ledger.noted).toEqual([])
  })

  it('leaves out an owner who switched the replies family off, and notes without a mail when all did', async () => {
    const world = await build({ households: 3, answered: 1 })
    await world.preferences.save(CO_HOST, { rsvp: false })

    await world.sweep()
    expect(world.mailer.sent.map((mail) => mail.to)).toEqual(['hote@example.test'])

    const nobody = await build({ households: 3, answered: 1 })
    await nobody.preferences.save(HOST, { rsvp: false })
    await nobody.preferences.save(CO_HOST, { rsvp: false })
    const report = await nobody.sweep()
    expect(report.noticed).toEqual([{ eventId: WEDDING, kind: 'rsvpDeadline' }])
    expect(nobody.mailer.sent).toEqual([])
  })

  it('keeps the event switch out of it: an owner with the event family off still gets the replies notices', async () => {
    const world = await build({ households: 3, answered: 1 })
    await world.preferences.save(HOST, { event: false })

    await world.sweep()

    expect(world.mailer.sent.map((mail) => mail.to)).toContain('hote@example.test')
  })

  it('is stopped for the whole box by HOST_MAIL_NOTICES=off', async () => {
    const world = await build({ households: 3, answered: 1, hostMailNotices: false })

    expect(await world.sweep()).toMatchObject({ noticed: [], sent: 0 })
  })

  it('is stopped even for an event that is a candidate for another reason (the erasure warning lists it)', async () => {
    const world = await build({ households: 3, answered: 1, hostMailNotices: false })
    const listed = Object.assign(Object.create(world.rsvps) as FakeGuestRsvpRepository, {
      eventsWithRepliesExpiringBefore: async () => [WEDDING],
    })

    const report = await makeSweepRsvpNotices({ ...world.deps, rsvps: listed })()

    expect(report).toMatchObject({ noticed: [], sent: 0 })
  })

  it('is held back by the day budget, neither noted nor sent, and goes the next day while it is fresh', async () => {
    const world = await build({ households: 3, answered: 1, budgetMax: 2 })
    // One mail already went today: the two owners' places no longer fit.
    await world.budget.count('2026-12-03', 1)

    const held = await world.sweep()

    expect(held).toMatchObject({ noticed: [], sent: 0, skippedBudget: 1 })
    expect(world.ledger.noted).toEqual([])

    world.clock.set(new Date('2026-12-04T12:00:00.000Z'))
    const later = await world.sweep()

    expect(later.noticed).toEqual([{ eventId: WEDDING, kind: 'rsvpDeadline' }])
    expect(world.mailer.sent).toHaveLength(2)
  })

  it('says nothing of a guest', async () => {
    const world = await build({ households: 3, answered: 1 })

    await world.sweep()

    const text = world.mailer.sent.map((mail) => `${mail.subject}\n${mail.text}`).join('\n')
    expect(text).not.toMatch(/Léa|Martin|gluten|Merci|Hugo|Texte libre/)
  })
})

describe('R4, the summary once the deadline stopped the replies', () => {
  const AFTER = new Date('2026-12-06T09:00:00.000Z')

  it('sends the figures, the host menus and the numbers of diets and households, once', async () => {
    const world = await build({ now: AFTER, households: 3, answered: 2, people: 3 })

    const report = await world.sweep()

    expect(report.noticed).toEqual([{ eventId: WEDDING, kind: 'rsvpStopped' }])
    const mail = world.mailer.sent[0]
    expect(mail?.subject).toContain('sont closes')
    expect(mail?.text).toContain('6 oui')
    expect(mail?.text).toContain('Poisson (2)')
    expect(mail?.text).toContain('2 régimes signalés')
    expect(mail?.text).toContain('1 foyer sans réponse')
    expect(`${mail?.subject}\n${mail?.text}`).not.toMatch(
      /Léa|Martin|gluten|Merci|Hugo|Texte libre/,
    )

    await world.sweep()
    expect(world.mailer.sent).toHaveLength(2)
  })

  it('is noted without a mail once it is more than a day old: the moment has gone', async () => {
    const world = await build({
      now: new Date('2026-12-07T12:00:00.000Z'),
      households: 3,
      answered: 2,
    })

    const report = await world.sweep()

    expect(report).toMatchObject({ stale: 1, sent: 0, noticed: [] })
    expect(world.ledger.noted).toEqual([
      { eventId: WEDDING, kind: 'rsvpStopped', key: '2026-12-05' },
    ])
    expect(await world.sweep()).toMatchObject({ stale: 0 })
  })

  it('is not owed when the host closed the replies by hand, nor while they are still open', async () => {
    const closed = await build({
      now: AFTER,
      households: 3,
      answered: 2,
      settings: settings({ closedAt: new Date('2026-12-04T10:00:00.000Z') }),
    })
    expect((await closed.sweep()).noticed).toEqual([])

    const open = await build({ households: 3, answered: 2 })
    expect(subjects(open)).toEqual([])
    expect((await open.sweep()).noticed.map((n) => n.kind)).not.toContain('rsvpStopped')
  })
})

describe('R5, the full house', () => {
  const full = (capacity: number) =>
    settings({ deadline: null, form: { ...DEFAULT_RSVP_FORM, capacity } })

  it('writes once when the people who come reach the capacity', async () => {
    const world = await build({ settings: full(10), households: 3, answered: 3, people: 4 })

    const report = await world.sweep()

    expect(report.noticed).toEqual([{ eventId: WEDDING, kind: 'rsvpFull' }])
    expect(world.mailer.sent[0]?.text).toContain('Les 10 places sont prises')
    await world.sweep()
    expect(world.mailer.sent).toHaveLength(2)
  })

  it('does not mail a house that has been full for weeks: the first pass after an update notes it without a mail', async () => {
    const world = await build({ settings: full(10), households: 3, answered: 3, people: 4 })
    for (let i = 0; i < 3; i += 1) {
      world.rsvps.seed(
        aRsvp({
          id: `r-${i}`,
          eventId: WEDDING,
          householdId: `h-${i}`,
          adults: 4,
          kids: 0,
          updatedAt: new Date('2026-11-10T10:00:00.000Z'),
        }),
      )
    }

    const report = await world.sweep()

    expect(report).toMatchObject({ noticed: [], sent: 0, stale: 1 })
    expect(world.ledger.noted).toEqual([{ eventId: WEDDING, kind: 'rsvpFull', key: 'full@10' }])
    expect((await world.sweep()).stale).toBe(0)
  })

  it('owes nothing below the capacity', async () => {
    const world = await build({ settings: full(10), households: 3, answered: 2, people: 4 })

    expect((await world.sweep()).noticed).toEqual([])
  })

  it('writes again when the host raises the capacity and the house fills again: one notice per capacity value', async () => {
    const world = await build({ settings: full(10), households: 3, answered: 3, people: 4 })
    await world.sweep()
    const first = world.mailer.sent.length

    await world.invites.saveRsvpSettings(WEDDING, full(15))
    expect((await world.sweep()).noticed).toEqual([])
    await world.invites.saveRsvpSettings(WEDDING, full(15))
    world.rsvps.seed(
      aRsvp({
        id: 'r-more',
        eventId: WEDDING,
        householdId: null,
        adults: 4,
        kids: 0,
        name: 'Autre',
        updatedAt: world.clock.now(),
      }),
    )
    const again = await world.sweep()

    expect(again.noticed).toEqual([{ eventId: WEDDING, kind: 'rsvpFull' }])
    expect(world.mailer.sent.length).toBeGreaterThan(first)
    expect(world.mailer.sent.at(-1)?.text).toContain('Les 15 places sont prises')
  })
})

describe('the calendar notices, in the cases that go wrong', () => {
  const full = (capacity: number) =>
    settings({ deadline: null, form: { ...DEFAULT_RSVP_FORM, capacity } })

  it('sends nothing for R3, R4 and R5 when another sweep noted the notice first: the lost note', async () => {
    const lost = { note: async () => false, has: async () => false }
    const r3 = await build({ households: 3, answered: 1 })
    expect(await makeSweepRsvpNotices({ ...r3.deps, notices: lost })()).toMatchObject({
      noticed: [],
      sent: 0,
    })
    const r4 = await build({
      now: new Date('2026-12-06T09:00:00.000Z'),
      households: 3,
      answered: 2,
    })
    expect(await makeSweepRsvpNotices({ ...r4.deps, notices: lost })()).toMatchObject({
      noticed: [],
      sent: 0,
    })
    const r5 = await build({ settings: full(10), households: 3, answered: 3, people: 4 })
    expect(await makeSweepRsvpNotices({ ...r5.deps, notices: lost })()).toMatchObject({
      noticed: [],
      sent: 0,
    })
    expect([r3, r4, r5].flatMap((world) => world.mailer.sent)).toEqual([])
  })

  it.each([
    ['R4', { now: '06:00', day: '2026-12-06' }],
    ['R5', { now: '06:00', day: '2026-12-03' }],
  ])(
    'keeps %s at night in the zone of the invitation and sends it from 08:00 local, not at 21:00',
    async (name, at) => {
      const options = (hour: string) => ({
        now: new Date(`${at.day}T${hour}:00.000Z`),
        households: 3,
        answered: 3,
        people: 4,
        ...(name === 'R5' ? { settings: full(10) } : {}),
      })
      // Paris is UTC+1: 06:59Z is 07:59 local (night), 07:00Z is 08:00 local, 19:59Z is 20:59 local, 20:00Z is 21:00 local (night).
      expect((await (await build(options('06:59'))).sweep()).noticed).toEqual([])
      expect((await (await build(options('07:00'))).sweep()).noticed).toHaveLength(1)
      expect((await (await build(options('19:59'))).sweep()).noticed).toHaveLength(1)
      expect((await (await build(options('20:00'))).sweep()).noticed).toEqual([])
    },
  )

  it('writes R4 and R5 only to the owners who kept the replies family on', async () => {
    const stopped = await build({
      now: new Date('2026-12-06T09:00:00.000Z'),
      households: 3,
      answered: 2,
    })
    await stopped.preferences.save(CO_HOST, { rsvp: false })
    await stopped.sweep()
    expect(stopped.mailer.sent.map((mail) => mail.to)).toEqual(['hote@example.test'])

    const filled = await build({ settings: full(10), households: 3, answered: 3, people: 4 })
    await filled.preferences.save(HOST, { rsvp: false })
    await filled.sweep()
    expect(filled.mailer.sent.map((mail) => mail.to)).toEqual(['cohote@example.test'])
  })

  it('computes no figure for an event whose replies are off: nothing of the calendar applies', async () => {
    const world = await build({
      settings: settings({ enabled: false }),
      households: 3,
      answered: 1,
    })
    let listed = 0
    const counted = Object.assign(Object.create(world.rsvps) as FakeGuestRsvpRepository, {
      // Listed for the erasure warning, so the sweep does reach the event.
      eventsWithRepliesExpiringBefore: async () => [WEDDING],
      listByEvent: async () => {
        listed += 1
        return []
      },
    })

    await makeSweepRsvpNotices({ ...world.deps, rsvps: counted })()

    expect(listed).toBe(0)
  })
})
