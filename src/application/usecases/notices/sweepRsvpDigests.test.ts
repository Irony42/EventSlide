import { describe, expect, it } from 'vitest'
import { aRsvp } from '../../../domain/guestRsvps/testing/rsvpFixtures'
import { DEFAULT_RSVP_FORM } from '../../../domain/guestRsvps/rsvpForm'
import { DEFAULT_RSVP_SETTINGS } from '../../../domain/guestRsvps/rsvpSettings'
import { asEventId, asGuestId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient, aGuestInvite, aGuestbookEntry, anEvent, aUser } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestHouseholdRepository } from '../../testing/fakeGuestHouseholdRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestInviteRepository } from '../../testing/fakeGuestInviteRepository'
import { FakeGuestRsvpRepository } from '../../testing/fakeGuestRsvpRepository'
import { FakeMailBudget } from '../../testing/fakeMailBudget'
import { FakeMailPreferenceRepository } from '../../testing/fakeMailPreferenceRepository'
import { FakeMailer } from '../../testing/fakeMailer'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import type { MailPreferenceRepository } from '../../ports/mailPreferenceRepository'
import type { Mailer } from '../../ports/mailer'
import { makeSweepRsvpDigests, type SweepRsvpDigestsDeps } from './sweepRsvpDigests'

/**
 * R2, the daily summary (spec 32, section 3.1), through the sweep. It is 09:30 in Paris on Wednesday 9 December; a reply came
 * in the evening before; the host ticked the summary for this event.
 */

const WEDDING = asEventId('evt-wedding')
const HOST = asUserId('user-host')
const CO_HOST = asUserId('user-cohost')
const MODERATOR = asUserId('user-mod')
const NOW = new Date('2026-12-09T08:30:00.000Z')
const EVENING = new Date('2026-12-08T18:00:00.000Z')

const build = async (
  options: {
    now?: Date
    hostMailNotices?: boolean
    budgetMax?: number | null
    mailer?: Mailer
    preferences?: MailPreferenceRepository
    ticked?: readonly (typeof HOST)[]
    replies?: number
    zone?: string | null
    client?: Parameters<typeof aClient>[0]
  } = {},
) => {
  const clients = new FakeClientRepository()
  const events = new FakeEventRepository({ clients })
  const users = new FakeUserRepository().seed(
    aUser({ id: HOST, email: 'hote@example.test' }),
    aUser({ id: CO_HOST, email: 'cohote@example.test' }),
    aUser({ id: MODERATOR, email: 'mod@example.test' }),
  )
  const preferences = new FakeMailPreferenceRepository()
    .withUsers(HOST, CO_HOST, MODERATOR)
    .withMembers(
      { eventId: WEDDING, userId: HOST },
      { eventId: WEDDING, userId: CO_HOST },
      { eventId: WEDDING, userId: MODERATOR },
    )
  for (const userId of options.ticked ?? [HOST]) await preferences.setDigest(WEDDING, userId, true)
  const memberships = new FakeMembershipRepository({ users, mailPreferences: preferences }).seed(
    { eventId: WEDDING, userId: HOST, role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: CO_HOST, role: 'owner', grantedAt: new Date(AT.getTime() + 1) },
    { eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT },
  )
  const rsvps = new FakeGuestRsvpRepository({ mailPreferences: preferences })
  rsvps.addMember(WEDDING, HOST).addMember(WEDDING, CO_HOST).addMember(WEDDING, MODERATOR)
  for (let i = 0; i < (options.replies ?? 2); i += 1) {
    rsvps.seed(
      aRsvp({
        id: `r-${i}`,
        eventId: WEDDING,
        name: 'Léa Martin',
        diet: 'sans gluten',
        message: 'Merci',
        updatedAt: EVENING,
        adults: 2,
        kids: 1,
      }),
    )
  }
  const households = new FakeGuestHouseholdRepository()
  const guestbook = new FakeGuestbookRepository().markViaRsvp(asGuestId('guest-absent'))
  guestbook.seed(
    aGuestbookEntry({ id: 'n1', eventId: WEDDING, guestId: 'guest-absent', text: 'Désolés' }),
    aGuestbookEntry({ id: 'm1', eventId: WEDDING, guestId: 'guest-other', text: 'Un message' }),
  )
  const invites = new FakeGuestInviteRepository()
  if (options.client !== undefined) clients.seed(aClient({ id: 'client-1', ...options.client }))
  events.seed(
    anEvent({
      id: WEDDING,
      slug: 'camille-et-sacha',
      joinCode: 'H7K2QM',
      name: 'Camille et Sacha',
      ...(options.client === undefined
        ? {}
        : { clientId: 'client-1', clientSuspendedAt: options.client.suspendedAt ?? null }),
    }),
  )
  await invites.create(
    aGuestInvite({
      eventId: WEDDING,
      enabled: true,
      ...(options.zone === null
        ? {}
        : {
            startsAt: '2026-12-13T18:00:00.000Z',
            timeZone: options.zone ?? 'Europe/Paris',
          }),
    }),
  )
  await invites.saveRsvpSettings(WEDDING, {
    ...DEFAULT_RSVP_SETTINGS,
    enabled: true,
    form: DEFAULT_RSVP_FORM,
  })
  const budget = new FakeMailBudget(options.budgetMax ?? null)
  const mailer = new FakeMailer()
  const logger = new CapturingLogger()
  const clock = new FakeClock(options.now ?? NOW)
  const deps: SweepRsvpDigestsDeps = {
    rsvps,
    households,
    guestbook,
    events,
    clients,
    invites,
    memberships,
    preferences: options.preferences ?? preferences,
    budget,
    mailer: options.mailer ?? mailer,
    clock,
    logger,
    publicUrl: 'https://photos.example.test',
    hostMailNotices: options.hostMailNotices ?? true,
  }
  return {
    sweep: makeSweepRsvpDigests(deps),
    deps,
    mailer,
    budget,
    clock,
    preferences,
    rsvps,
    events,
    clients,
    logger,
  }
}

describe('sweepRsvpDigests', () => {
  it('writes a summary to the owner who ticked it, claims it, and writes none more the same day', async () => {
    const world = await build()

    const report = await world.sweep()

    expect(report).toMatchObject({ claimed: 1, sent: 1, unsent: 0, skippedBudget: 0, failed: [] })
    expect(world.mailer.sent.map((mail) => mail.to)).toEqual(['hote@example.test'])
    expect(world.mailer.sent[0]?.text).toContain('2 réponses nouvelles ou modifiées')
    expect(world.mailer.sent[0]?.text).toContain('1 mot d’absent attend votre accord.')
    expect(world.mailer.sent[0]?.text).toContain('/admin/events/camille-et-sacha/rsvps')
    expect((await world.preferences.digestFor(WEDDING, HOST)).lastAt).toEqual(NOW)

    world.clock.advance(3_600_000)
    expect(await world.sweep()).toMatchObject({ claimed: 0, sent: 0 })
  })

  it('writes the next day when something new came after the last summary, and counts only what is new', async () => {
    const world = await build()
    await world.sweep()
    world.rsvps.seed(
      aRsvp({
        id: 'r-new',
        eventId: WEDDING,
        updatedAt: new Date('2026-12-09T12:00:00.000Z'),
        adults: 1,
        kids: 0,
      }),
    )

    world.clock.set(new Date('2026-12-10T08:30:00.000Z'))
    const report = await world.sweep()

    expect(report.sent).toBe(1)
    expect(world.mailer.sent.at(-1)?.text).toContain('1 réponse nouvelle ou modifiée')
  })

  it('says nothing of a guest', async () => {
    const world = await build()

    await world.sweep()

    const mail = world.mailer.sent[0]
    expect(`${mail?.subject}\n${mail?.text}`).not.toMatch(/Léa|Martin|gluten|Merci/)
  })

  it('writes to nobody who did not tick it, nor when the host already looked after the change', async () => {
    const none = await build({ ticked: [] })
    expect(await none.sweep()).toMatchObject({ claimed: 0 })

    const seen = await build()
    await seen.rsvps.markSeen(WEDDING, HOST, NOW)
    expect(await seen.sweep()).toMatchObject({ claimed: 0 })
  })

  it('lets the account switch beat the tick: replies family off means no summary', async () => {
    const world = await build()
    await world.preferences.save(HOST, { rsvp: false })

    expect(await world.sweep()).toMatchObject({ claimed: 0, sent: 0 })
  })

  it('does not care for the event family switch', async () => {
    const world = await build()
    await world.preferences.save(HOST, { event: false })

    expect((await world.sweep()).sent).toBe(1)
  })

  it('is stopped for the box by HOST_MAIL_NOTICES=off, and without a relay', async () => {
    const off = await build({ hostMailNotices: false })
    expect(await off.sweep()).toMatchObject({ claimed: 0 })

    const noRelay = await build({
      mailer: { canDeliver: false, send: async () => ({ ok: true, value: undefined }) },
    })
    expect(await noRelay.sweep()).toMatchObject({ claimed: 0 })
    expect((await noRelay.preferences.digestFor(WEDDING, HOST)).lastAt).toBeNull()
  })

  it('reads an invitation with no zone in Paris', async () => {
    const world = await build({ zone: null })

    expect((await world.sweep()).claimed).toBe(1)
  })

  it('leaves at 09:00 local and not before, and not after 21:00, in the zone of the invitation', async () => {
    const early = await build({ now: new Date('2026-12-09T07:59:00.000Z') })
    expect(await early.sweep()).toMatchObject({ claimed: 0 })

    const night = await build({ now: new Date('2026-12-09T20:00:00.000Z') })
    expect(await night.sweep()).toMatchObject({ claimed: 0 })

    const auckland = await build({
      zone: 'Pacific/Auckland',
      now: new Date('2026-12-08T20:30:00.000Z'),
    })
    expect((await auckland.sweep()).claimed).toBe(1)
  })

  it('writes only to an owner of an active account: a disabled owner and a moderator are not written to', async () => {
    const world = await build({ ticked: [HOST, CO_HOST, MODERATOR] })
    world.deps.memberships.ownersToNotify = async () => []

    expect(await world.sweep()).toMatchObject({ claimed: 0 })

    const live = await build({ ticked: [HOST, CO_HOST, MODERATOR] })
    const report = await live.sweep()
    expect(live.mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'cohote@example.test',
      'hote@example.test',
    ])
    expect(report.claimed).toBe(2)
  })

  it('is held back by the day budget, neither claimed nor sent, and goes on the next pass', async () => {
    const world = await build({ budgetMax: 1 })
    await world.budget.count('2026-12-09', 1)

    expect(await world.sweep()).toMatchObject({ claimed: 0, sent: 0, skippedBudget: 1 })
    expect((await world.preferences.digestFor(WEDDING, HOST)).lastAt).toBeNull()

    world.clock.set(new Date('2026-12-10T08:30:00.000Z'))
    expect((await world.sweep()).sent).toBe(1)
  })

  it('sends nothing when another sweep claimed the summary first: the winner of the claim sends', async () => {
    const real = new FakeMailPreferenceRepository()
    const lost: MailPreferenceRepository = {
      forUser: (id) => real.forUser(id),
      save: (id, patch) => real.save(id, patch),
      digestFor: (e, u) => real.digestFor(e, u),
      setDigest: (e, u, on) => real.setDigest(e, u, on),
      claimDigest: async () => false,
    }
    const world = await build({ preferences: lost })

    expect(await world.sweep()).toMatchObject({ claimed: 0, sent: 0 })
  })

  it('counts a refused message, logs the code and never the address, and does not retry it', async () => {
    const world = await build()
    world.mailer.failNextWith('transient')

    const report = await world.sweep()

    expect(report).toMatchObject({ claimed: 1, sent: 0, unsent: 1 })
    expect(JSON.stringify(world.logger.lines)).toContain('a replies digest was not sent')
    expect(JSON.stringify(world.logger.lines)).not.toContain('example.test')
    world.clock.advance(60_000)
    expect(await world.sweep()).toMatchObject({ claimed: 0 })
  })

  it('counts an owner whose stored address is not an address as unsent', async () => {
    const world = await build()
    world.deps.memberships.ownersToNotify = async () => [
      {
        userId: HOST,
        email: 'not an address',
        mail: { rsvp: true, event: true },
        rsvpDigest: true,
        rsvpDigestAt: null,
      },
    ]

    expect(await world.sweep()).toMatchObject({ claimed: 1, unsent: 1 })
  })

  it('skips an event the operator took down, of a suspended client or of a client being closed', async () => {
    const down = await build()
    await down.events.setTakenDown(WEDDING, AT)
    expect(await down.sweep()).toMatchObject({ claimed: 0 })

    const closing = await build({ client: { purgeAfter: new Date(NOW.getTime() + 86_400_000) } })
    expect(await closing.sweep()).toMatchObject({ claimed: 0 })

    const suspended = await build({ client: { suspendedAt: AT } })
    expect(await suspended.sweep()).toMatchObject({ claimed: 0 })
  })

  it('writes in the language of the client when the event has one', async () => {
    const world = await build({ client: { locale: 'en' } })

    await world.sweep()

    expect(world.mailer.sent[0]?.subject).toContain('more replies')
  })

  it('skips a candidate whose event or invitation is gone', async () => {
    const gone = await build()
    gone.deps.events.findById = async () => null
    expect(await gone.sweep()).toMatchObject({ claimed: 0 })

    const bare = await build()
    bare.deps.invites.findByEvent = async () => null
    expect(await bare.sweep()).toMatchObject({ claimed: 0 })
  })

  it('never throws: a candidate it cannot examine is listed, a candidate list it cannot read is logged', async () => {
    const world = await build()
    world.deps.events.findById = async () => {
      throw new Error('database is locked')
    }
    expect((await world.sweep()).failed).toEqual(['evt-wedding:user-host'])

    const listing = await build()
    listing.deps.rsvps.digestCandidates = async () => {
      throw new Error('database is locked hote@example.test')
    }
    expect(await listing.sweep()).toMatchObject({ claimed: 0, failed: [] })
    expect(JSON.stringify(listing.logger.lines)).toContain('could not list')
    expect(JSON.stringify(listing.logger.lines)).not.toContain('example.test')

    const plain = await build()
    plain.deps.rsvps.digestCandidates = async () => {
      throw 'plain'
    }
    await plain.sweep()
    expect(JSON.stringify(plain.logger.lines)).toContain('unknown')
  })
})
