import { describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient, anEvent, aUser } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventMailNoticeLedger } from '../../testing/fakeEventMailNoticeLedger'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMailBudget } from '../../testing/fakeMailBudget'
import { FakeMailPreferenceRepository } from '../../testing/fakeMailPreferenceRepository'
import { FakeMailer } from '../../testing/fakeMailer'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import type { Mailer } from '../../ports/mailer'
import { makeNotifyJobDone, type JobFinished, type NotifyJobDoneDeps } from './notifyJobDone'

/**
 * A2 (spec 32, section 3.3): the mail that tells the host a long job is over. It is 15:00 UTC on Saturday 28 November (16:00 in
 * Paris); the job was asked for at 14:00 and is over, a host and a co-host own the event, a moderator is on it.
 */

const WEDDING = asEventId('evt-wedding')
const HOST = asUserId('user-host')
const CO_HOST = asUserId('user-cohost')
const MODERATOR = asUserId('user-mod')
const REQUESTED = new Date('2026-11-28T14:00:00.000Z')
const NOW = new Date('2026-11-28T15:00:00.000Z')

const finished = (patch: Partial<JobFinished> = {}): JobFinished => ({
  job: 'book',
  eventId: WEDDING,
  requestedAt: REQUESTED,
  requestedBy: null,
  outcome: 'done',
  finishedAt: NOW,
  ...patch,
})

const build = async (
  options: {
    now?: Date
    hostMailNotices?: boolean
    budgetMax?: number | null
    mailer?: Mailer
    client?: Parameters<typeof aClient>[0]
    seedEvent?: boolean
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
  if (options.client !== undefined) clients.seed(aClient({ id: 'client-1', ...options.client }))
  if (options.seedEvent !== false) {
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
  }
  const ledger = new FakeEventMailNoticeLedger().withEvents(WEDDING)
  const budget = new FakeMailBudget(options.budgetMax ?? null)
  const mailer = new FakeMailer()
  const logger = new CapturingLogger()
  const clock = new FakeClock(options.now ?? NOW)
  const deps: NotifyJobDoneDeps = {
    events,
    clients,
    memberships,
    notices: ledger,
    budget,
    mailer: options.mailer ?? mailer,
    clock,
    logger,
    publicUrl: 'https://photos.example.test',
    hostMailNotices: options.hostMailNotices ?? true,
  }
  return {
    hook: makeNotifyJobDone(deps),
    deps,
    mailer,
    ledger,
    budget,
    preferences,
    events,
    logger,
  }
}

describe('notifyJobDone (A2)', () => {
  it('tells every owner, and not the moderator, that the photo book is ready, with the page of the book', async () => {
    const world = await build()

    world.hook.notify(finished())
    await world.hook.idle()

    expect(world.mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'cohote@example.test',
      'hote@example.test',
    ])
    expect(world.mailer.sent[0]?.text).toContain('Le livre photo de')
    expect(world.mailer.sent[0]?.text).toContain('est prêt.')
    expect(world.mailer.sent[0]?.text).toContain(
      'https://photos.example.test/admin/events/camille-et-sacha/book',
    )
  })

  it('points each job at its own page', async () => {
    for (const [job, page] of [
      ['archive', 'album'],
      ['reel', 'best-of'],
    ] as const) {
      const world = await build()
      world.hook.notify(finished({ job }))
      await world.hook.idle()
      expect(world.mailer.sent[0]?.text).toContain(`/admin/events/camille-et-sacha/${page}\n`)
    }
  })

  it('says a failure, in the language of the event', async () => {
    const world = await build({ client: { locale: 'en' } })

    world.hook.notify(finished({ outcome: 'failed' }))
    await world.hook.idle()

    expect(world.mailer.sent[0]?.subject).toBe(
      'The photo book of "Camille et Sacha" could not be made; try again from the page.',
    )
  })

  it('is owed only to a job that took more than two minutes: 2:00 exactly is not, 2:01 is', async () => {
    const quick = await build()
    quick.hook.notify(finished({ requestedAt: new Date(NOW.getTime() - 120_000), finishedAt: NOW }))
    await quick.hook.idle()
    expect(quick.mailer.sent).toEqual([])
    expect(quick.ledger.noted).toEqual([])

    const slow = await build()
    slow.hook.notify(finished({ requestedAt: new Date(NOW.getTime() - 121_000) }))
    await slow.hook.idle()
    expect(slow.mailer.sent).toHaveLength(2)
  })

  it('writes an archive to the owner who asked for it, and to the owners when that one is gone or only a moderator', async () => {
    const asked = await build()
    asked.hook.notify(finished({ job: 'archive', requestedBy: CO_HOST }))
    await asked.hook.idle()
    expect(asked.mailer.sent.map((mail) => mail.to)).toEqual(['cohote@example.test'])

    const moderator = await build()
    moderator.hook.notify(finished({ job: 'archive', requestedBy: MODERATOR }))
    await moderator.hook.idle()
    expect(moderator.mailer.sent).toHaveLength(2)

    const unknown = await build()
    unknown.hook.notify(finished({ job: 'archive', requestedBy: asUserId('user-gone') }))
    await unknown.hook.idle()
    expect(unknown.mailer.sent).toHaveLength(2)
  })

  it('honours the event switch of the owner who asked for the archive: nobody is written to instead', async () => {
    const world = await build()
    await world.preferences.save(CO_HOST, { event: false })

    world.hook.notify(finished({ job: 'archive', requestedBy: CO_HOST }))
    await world.hook.idle()

    expect(world.mailer.sent).toEqual([])
    expect(world.ledger.noted).toHaveLength(1)
  })

  it('does not narrow a book or a film to anybody: nobody asked for it by name', async () => {
    for (const job of ['book', 'reel'] as const) {
      const world = await build()
      world.hook.notify(finished({ job, requestedBy: CO_HOST }))
      await world.hook.idle()
      expect(world.mailer.sent).toHaveLength(2)
    }
  })

  it('leaves out an owner who switched the event family off, and notes without a mail when all did', async () => {
    const world = await build()
    await world.preferences.save(CO_HOST, { event: false })
    world.hook.notify(finished())
    await world.hook.idle()
    expect(world.mailer.sent.map((mail) => mail.to)).toEqual(['hote@example.test'])

    const nobody = await build()
    await nobody.preferences.save(HOST, { event: false })
    await nobody.preferences.save(CO_HOST, { event: false })
    nobody.hook.notify(finished())
    await nobody.hook.idle()
    expect(nobody.mailer.sent).toEqual([])
    expect(nobody.ledger.noted).toHaveLength(1)
  })

  it('keeps the replies switch out of it', async () => {
    const world = await build()
    await world.preferences.save(HOST, { rsvp: false })

    world.hook.notify(finished())
    await world.hook.idle()

    expect(world.mailer.sent.map((mail) => mail.to)).toContain('hote@example.test')
  })

  it('notes before it sends, under the key job@requested_at, so a job finished twice sends one mail', async () => {
    const world = await build()

    world.hook.notify(finished())
    world.hook.notify(finished())
    await world.hook.idle()

    expect(world.mailer.sent).toHaveLength(2)
    expect(world.ledger.noted).toEqual([
      { eventId: WEDDING, kind: 'jobDone', key: 'book@2026-11-28T14:00:00.000Z' },
    ])

    world.hook.notify(finished({ requestedAt: new Date('2026-11-28T13:00:00.000Z') }))
    world.hook.notify(finished({ job: 'reel' }))
    await world.hook.idle()
    expect(world.mailer.sent).toHaveLength(6)
  })

  it('does not wait for the morning: the host who left is waiting for it', async () => {
    const night = new Date('2026-11-28T01:00:00.000Z')
    const world = await build({ now: night })

    world.hook.notify(
      finished({ requestedAt: new Date('2026-11-28T00:00:00.000Z'), finishedAt: night }),
    )
    await world.hook.idle()

    expect(world.mailer.sent).toHaveLength(2)
  })

  it('takes its places in the day budget, and is neither noted nor sent when the day is full', async () => {
    const world = await build({ budgetMax: 3 })
    await world.budget.count('2026-11-28', 2)

    world.hook.notify(finished())
    await world.hook.idle()

    expect(world.mailer.sent).toEqual([])
    expect(world.ledger.noted).toEqual([])
    expect(await world.budget.used('2026-11-28')).toBe(2)
  })

  it('is noted without a mail when it is more than a day old by the time it is looked at', async () => {
    const world = await build({ now: new Date('2026-11-29T16:00:00.000Z') })

    world.hook.notify(finished())
    await world.hook.idle()

    expect(world.mailer.sent).toEqual([])
    expect(world.ledger.noted).toHaveLength(1)
  })

  it('sends nothing, and notes nothing, with HOST_MAIL_NOTICES=off or without a relay', async () => {
    const off = await build({ hostMailNotices: false })
    off.hook.notify(finished())
    await off.hook.idle()
    expect(off.mailer.sent).toEqual([])
    expect(off.ledger.noted).toEqual([])

    const sent: string[] = []
    const none = await build({
      mailer: {
        canDeliver: false,
        send: async () => {
          sent.push('mail')
          throw new Error('no relay')
        },
      },
    })
    none.hook.notify(finished())
    await none.hook.idle()
    expect(sent).toEqual([])
    expect(none.ledger.noted).toEqual([])
  })

  it('writes about no event the operator took down, of a suspended client or of a client being closed, nor one that is gone', async () => {
    const down = await build()
    await down.events.setTakenDown(WEDDING, NOW)
    down.hook.notify(finished())
    await down.hook.idle()

    const suspended = await build({ client: { suspendedAt: AT } })
    suspended.hook.notify(finished())
    await suspended.hook.idle()

    const closing = await build({ client: { purgeAfter: new Date('2027-01-01T00:00:00.000Z') } })
    closing.hook.notify(finished())
    await closing.hook.idle()

    const gone = await build({ seedEvent: false })
    gone.hook.notify(finished())
    await gone.hook.idle()

    expect(
      [down, suspended, closing, gone].flatMap((world) => [
        ...world.mailer.sent,
        ...world.ledger.noted,
      ]),
    ).toEqual([])
  })

  it('never rejects and never waits: a ledger that fails is logged by the name of the error, not its message', async () => {
    const world = await build()
    const broken = makeNotifyJobDone({
      ...world.deps,
      notices: {
        has: async () => false,
        note: async () => {
          throw new TypeError('secret hote@example.test')
        },
      },
    })

    broken.notify(finished())
    await broken.idle()

    const line = world.logger.lines.find((entry) => entry.message === 'a job notice failed')
    expect(line?.context).toEqual({ job: 'book', error: 'TypeError' })
    expect(JSON.stringify(world.logger.lines)).not.toContain('hote@example.test')

    const plain = makeNotifyJobDone({
      ...world.deps,
      events: {
        findById: async () => {
          throw 'plain'
        },
      },
    })
    plain.notify(finished())
    await plain.idle()
    expect(
      world.logger.lines.filter((entry) => entry.message === 'a job notice failed').at(-1)?.context,
    ).toEqual({ job: 'book', error: 'unknown' })
  })

  it('does not hold the worker: notify returns before the mail is sent', async () => {
    const world = await build()

    world.hook.notify(finished())

    expect(world.mailer.sent).toEqual([])
    await world.hook.idle()
    expect(world.mailer.sent).toHaveLength(2)
  })

  it('counts a refusal by the relay as unsent and logs its code, never the address', async () => {
    const world = await build()
    world.mailer.failNextWith('rejected')

    world.hook.notify(finished())
    await world.hook.idle()

    expect(world.mailer.sent).toHaveLength(1)
    expect(world.logger.lines.some((entry) => entry.message === 'a host notice was not sent')).toBe(
      true,
    )
    expect(JSON.stringify(world.logger.lines)).not.toContain('example.test')
  })
})
