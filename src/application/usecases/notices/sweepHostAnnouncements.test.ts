import { describe, expect, it } from 'vitest'
import type { HostAnnouncement } from '../../../domain/hostAnnouncements/hostAnnouncement'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClock } from '../../testing/fakeClock'
import { FakeHostAnnouncementRepository } from '../../testing/fakeHostAnnouncementRepository'
import { FakeMailBudget } from '../../testing/fakeMailBudget'
import { FakeMailer } from '../../testing/fakeMailer'
import type { Mailer } from '../../ports/mailer'
import {
  makeSweepHostAnnouncements,
  type SweepHostAnnouncementsDeps,
} from './sweepHostAnnouncements'

/**
 * A8 (spec 32, lot 2), through the sweep: one mail per account, never an address in copy, by batches, within the day's budget,
 * resumable and never twice.
 */

const NOW = new Date('2026-11-28T03:00:00.000Z')
const CONTACT = (() => {
  const made = EmailAddress.create('contact@operateur.example')
  if (!made.ok) throw new Error('fixture')
  return made.value
})()

const announcement = (id: string, patch: Partial<HostAnnouncement> = {}): HostAnnouncement => ({
  id,
  subject: 'Nouvelles conditions',
  text: 'Elles changent le 1er janvier.',
  link: null,
  createdBy: null,
  createdAt: new Date('2026-11-27T10:00:00.000Z'),
  finishedAt: null,
  ...patch,
})

const build = async (
  options: {
    owners?: number
    budgetMax?: number | null
    mailer?: Mailer
    batchPerPass?: number
    announcements?: readonly HostAnnouncement[]
    contact?: EmailAddress | null
  } = {},
) => {
  const announcements = new FakeHostAnnouncementRepository()
  for (let i = 1; i <= (options.owners ?? 3); i += 1) {
    announcements.withOwner(`user-${String(i).padStart(3, '0')}`, `hote${i}@example.test`)
  }
  for (const held of options.announcements ?? [announcement('a-one')]) {
    await announcements.create(held)
  }
  const budget = new FakeMailBudget(options.budgetMax ?? null)
  const mailer = new FakeMailer()
  const logger = new CapturingLogger()
  const clock = new FakeClock(NOW)
  const deps: SweepHostAnnouncementsDeps = {
    announcements,
    budget,
    mailer: options.mailer ?? mailer,
    clock,
    logger,
    operatorContact: options.contact === undefined ? CONTACT : options.contact,
    ...(options.batchPerPass === undefined ? {} : { batchPerPass: options.batchPerPass }),
  }
  return {
    sweep: makeSweepHostAnnouncements(deps),
    deps,
    announcements,
    budget,
    mailer,
    logger,
    clock,
  }
}

describe('sweepHostAnnouncements (A8)', () => {
  it('writes the operator’s subject and text to every owner, once each, with the operator’s address to answer, then finishes', async () => {
    const world = await build()

    const report = await world.sweep()

    expect(report).toEqual({ sent: 3, unsent: 0, heldByBudget: false, finished: 1, failed: [] })
    expect(world.mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'hote1@example.test',
      'hote2@example.test',
      'hote3@example.test',
    ])
    expect(world.mailer.sent[0]?.subject).toBe('Nouvelles conditions')
    expect(world.mailer.sent[0]?.text).toContain('Elles changent le 1er janvier.')
    expect(world.mailer.sent[0]?.replyTo).toBe('contact@operateur.example')
    expect((await world.announcements.unfinished()).map((row) => row.id)).toEqual([])
  })

  it('never copies an address: one recipient per mail', async () => {
    const world = await build()

    await world.sweep()

    for (const mail of world.mailer.sent) {
      expect(mail.to).toMatch(/^hote\d@example\.test$/)
      expect(mail.text).not.toMatch(/hote\d@example/)
    }
  })

  it('writes nothing more on the next pass: an announcement that finished is done, and nobody is written to twice', async () => {
    const world = await build()
    await world.sweep()

    expect(await world.sweep()).toMatchObject({ sent: 0, finished: 0 })
    expect(world.mailer.sent).toHaveLength(3)
  })

  it('sends by batches: a pass sends at most the batch, the next one goes on where it stopped, and the last one finishes', async () => {
    const world = await build({ owners: 5, batchPerPass: 2 })

    expect(await world.sweep()).toMatchObject({ sent: 2, finished: 0 })
    expect(await world.sweep()).toMatchObject({ sent: 2, finished: 0 })
    expect(await world.sweep()).toMatchObject({ sent: 1, finished: 1 })
    expect(world.mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'hote1@example.test',
      'hote2@example.test',
      'hote3@example.test',
      'hote4@example.test',
      'hote5@example.test',
    ])
  })

  it('is resumable after a restart: a fresh sweep over the same deliveries writes only to those not yet reached', async () => {
    const world = await build({ owners: 4, batchPerPass: 2 })
    await world.sweep()

    // A restart is a new sweep over the same stored deliveries.
    const restarted = makeSweepHostAnnouncements({ ...world.deps, batchPerPass: 10 })
    const report = await restarted()

    expect(report).toMatchObject({ sent: 2, finished: 1 })
    expect(world.mailer.sent).toHaveLength(4)
    expect(new Set(world.mailer.sent.map((mail) => mail.to)).size).toBe(4)
  })

  it('stops at the day’s budget, counts what it sent, and goes on the next day while nothing is lost', async () => {
    const world = await build({ owners: 5, budgetMax: 3 })

    const held = await world.sweep()

    expect(held).toMatchObject({ sent: 3, heldByBudget: true, finished: 0 })
    expect(await world.budget.used('2026-11-28')).toBe(3)

    world.clock.set(new Date('2026-11-29T03:00:00.000Z'))
    const next = await world.sweep()

    expect(next).toMatchObject({ sent: 2, heldByBudget: false, finished: 1 })
    expect(world.mailer.sent).toHaveLength(5)
  })

  it('does not write to an owner whose account was switched off since', async () => {
    const world = await build()
    world.announcements.switchOff('user-002')

    await world.sweep()

    expect(world.mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'hote1@example.test',
      'hote3@example.test',
    ])
  })

  it('goes oldest announcement first, sharing the batch, and finishes each when nobody is left owed', async () => {
    const world = await build({
      owners: 2,
      announcements: [
        announcement('a-late', {
          subject: 'Seconde',
          createdAt: new Date('2026-11-27T12:00:00.000Z'),
        }),
        announcement('a-early', {
          subject: 'Première',
          createdAt: new Date('2026-11-27T09:00:00.000Z'),
        }),
      ],
    })

    const report = await world.sweep()

    expect(report).toMatchObject({ sent: 4, finished: 2 })
    expect(world.mailer.sent.map((mail) => mail.subject)).toEqual([
      'Première',
      'Première',
      'Seconde',
      'Seconde',
    ])
  })

  it('stops at the batch when the first announcement fills it exactly: the next one waits for the next pass', async () => {
    const world = await build({
      owners: 2,
      batchPerPass: 2,
      announcements: [
        announcement('a-early', { createdAt: new Date('2026-11-27T09:00:00.000Z') }),
        announcement('a-late', { createdAt: new Date('2026-11-27T12:00:00.000Z') }),
      ],
    })

    const report = await world.sweep()

    expect(report).toMatchObject({ sent: 2, finished: 1 })
    expect(world.mailer.sent).toHaveLength(2)
  })

  it('writes nothing, and stamps nothing, without a relay: the announcement waits', async () => {
    const world = await build({
      mailer: {
        canDeliver: false,
        send: async () => {
          throw new Error('no relay')
        },
      },
    })

    expect(await world.sweep()).toMatchObject({ sent: 0, finished: 0 })
    expect((await world.announcements.unfinished()).map((row) => row.id)).toEqual(['a-one'])
  })

  it('counts a refusal by the relay as unsent, logs its code and the announcement, never an address, and does not retry it', async () => {
    const world = await build()
    world.mailer.failNextWith('rejected')

    const report = await world.sweep()

    expect(report).toMatchObject({ sent: 2, unsent: 1, finished: 1 })
    expect(
      world.logger.lines.find((entry) => entry.message === 'a host announcement was not sent')
        ?.context,
    ).toEqual({ announcementId: 'a-one', code: 'mail.rejected' })
    expect(JSON.stringify(world.logger.lines)).not.toContain('example.test')
    expect(await world.sweep()).toMatchObject({ sent: 0 })
  })

  it('notes a stored address it cannot write to as unsent and goes on', async () => {
    const world = await build({ owners: 0 })
    world.announcements
      .withOwner('user-001', 'not an address')
      .withOwner('user-002', 'ok@example.test')

    const report = await world.sweep()

    expect(report).toMatchObject({ sent: 1, unsent: 1, finished: 1 })
  })

  it('skips an account another sweep already noted: the one that wrote the row sends', async () => {
    const world = await build({ owners: 2 })
    const racing = {
      ...world.announcements,
      unfinished: () => world.announcements.unfinished(),
      pendingRecipients: (id: string, limit: number) =>
        world.announcements.pendingRecipients(id, limit),
      recordDelivery: async () => false,
      finish: (id: string, at: Date) => world.announcements.finish(id, at),
    }

    const report = await makeSweepHostAnnouncements({ ...world.deps, announcements: racing })()

    expect(report).toMatchObject({ sent: 0 })
    expect(world.mailer.sent).toEqual([])
  })

  it('runs one pass at a time: a second call while one is running is that same pass', async () => {
    const world = await build()

    const [first, second] = await Promise.all([world.sweep(), world.sweep()])

    expect(second).toBe(first)
    expect(world.mailer.sent).toHaveLength(3)
  })

  it('lists nothing and fails nowhere when the announcements cannot be read, and says so by the name of the error', async () => {
    const world = await build()
    const broken = makeSweepHostAnnouncements({
      ...world.deps,
      announcements: {
        ...world.announcements,
        unfinished: async () => {
          throw new RangeError('secret')
        },
        pendingRecipients: async () => [],
        recordDelivery: async () => false,
        finish: async () => {},
      },
    })

    expect(await broken()).toMatchObject({ sent: 0, failed: [] })
    expect(
      world.logger.lines.find((entry) => entry.message === 'host announcements could not be listed')
        ?.context,
    ).toEqual({ error: 'RangeError' })
    const plain = makeSweepHostAnnouncements({
      ...world.deps,
      announcements: {
        ...world.announcements,
        unfinished: async () => {
          throw 'plain'
        },
        pendingRecipients: async () => [],
        recordDelivery: async () => false,
        finish: async () => {},
      },
    })
    await plain()
    expect(
      world.logger.lines
        .filter((entry) => entry.message === 'host announcements could not be listed')
        .at(-1)?.context,
    ).toEqual({ error: 'unknown' })
  })

  it('reports the announcement it could not examine and goes on to the others', async () => {
    const world = await build({
      owners: 1,
      announcements: [
        announcement('a-broken', { createdAt: new Date('2026-11-27T09:00:00.000Z') }),
        announcement('a-fine', { createdAt: new Date('2026-11-27T10:00:00.000Z') }),
      ],
    })
    const flaky = {
      ...world.announcements,
      unfinished: () => world.announcements.unfinished(),
      pendingRecipients: async (id: string, limit: number) => {
        if (id === 'a-broken') throw new TypeError('secret hote1@example.test')
        return world.announcements.pendingRecipients(id, limit)
      },
      recordDelivery: (id: string, user: string, at: Date) =>
        world.announcements.recordDelivery(id, user, at),
      finish: (id: string, at: Date) => world.announcements.finish(id, at),
    }

    const report = await makeSweepHostAnnouncements({ ...world.deps, announcements: flaky })()

    expect(report).toMatchObject({ sent: 1, finished: 1, failed: ['a-broken'] })
    expect(
      world.logger.lines.find(
        (entry) => entry.message === 'a host announcement could not be examined',
      )?.context,
    ).toEqual({ announcementId: 'a-broken', error: 'TypeError' })
    expect(JSON.stringify(world.logger.lines)).not.toContain('example.test')
  })

  it('names an error that is not an Error unknown', async () => {
    const world = await build({ owners: 1 })
    const flaky = {
      ...world.announcements,
      unfinished: () => world.announcements.unfinished(),
      pendingRecipients: async () => {
        throw 'plain'
      },
      recordDelivery: async () => false,
      finish: async () => {},
    }

    await makeSweepHostAnnouncements({ ...world.deps, announcements: flaky })()

    expect(
      world.logger.lines.find(
        (entry) => entry.message === 'a host announcement could not be examined',
      )?.context,
    ).toEqual({ announcementId: 'a-one', error: 'unknown' })
  })
})
