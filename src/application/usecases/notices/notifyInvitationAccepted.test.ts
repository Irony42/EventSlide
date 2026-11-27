import { describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient, anEvent, aUser } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMailBudget } from '../../testing/fakeMailBudget'
import { FakeMailPreferenceRepository } from '../../testing/fakeMailPreferenceRepository'
import { FakeMailer } from '../../testing/fakeMailer'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import type { Mailer } from '../../ports/mailer'
import {
  makeNotifyInvitationAccepted,
  type InvitationAccepted,
  type NotifyInvitationAcceptedDeps,
} from './notifyInvitationAccepted'

/**
 * A6 (spec 32, section 3.3): the mail that tells the host an invitation to moderate was accepted. The host wrote the invitation,
 * a co-host also owns the event, and a moderator (the one who just accepted) is on it.
 */

const WEDDING = asEventId('evt-wedding')
const HOST = asUserId('user-host')
const CO_HOST = asUserId('user-cohost')
const NEWCOMER = asUserId('user-newcomer')
const NBSP = String.fromCharCode(160)
const NOW = new Date('2026-11-28T03:00:00.000Z')

const accepted = (patch: Partial<InvitationAccepted> = {}): InvitationAccepted => ({
  eventId: WEDDING,
  createdBy: HOST,
  acceptedBy: NEWCOMER,
  role: 'moderator',
  who: 'Marie Dupont',
  address: 'marie@example.test',
  ...patch,
})

const build = async (
  options: {
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
    aUser({ id: NEWCOMER, email: 'marie@example.test' }),
  )
  const preferences = new FakeMailPreferenceRepository().withUsers(HOST, CO_HOST, NEWCOMER)
  const memberships = new FakeMembershipRepository({ users, mailPreferences: preferences }).seed(
    { eventId: WEDDING, userId: HOST, role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: CO_HOST, role: 'owner', grantedAt: new Date(AT.getTime() + 1) },
    { eventId: WEDDING, userId: NEWCOMER, role: 'moderator', grantedAt: AT },
  )
  if (options.client !== undefined) clients.seed(aClient({ id: 'client-1', ...options.client }))
  if (options.seedEvent !== false) {
    events.seed(
      anEvent({
        id: WEDDING,
        slug: 'camille-et-sacha',
        name: 'Camille et Sacha',
        ...(options.client === undefined
          ? {}
          : { clientId: 'client-1', clientSuspendedAt: options.client.suspendedAt ?? null }),
      }),
    )
  }
  const budget = new FakeMailBudget(options.budgetMax ?? null)
  const mailer = new FakeMailer()
  const logger = new CapturingLogger()
  const deps: NotifyInvitationAcceptedDeps = {
    events,
    clients,
    memberships,
    budget,
    mailer: options.mailer ?? mailer,
    clock: new FakeClock(NOW),
    logger,
    publicUrl: 'https://photos.example.test',
    hostMailNotices: options.hostMailNotices ?? true,
  }
  return {
    hook: makeNotifyInvitationAccepted(deps),
    deps,
    mailer,
    budget,
    preferences,
    events,
    logger,
    memberships,
  }
}

describe('notifyInvitationAccepted (A6)', () => {
  it('tells the account that wrote the invitation, and nobody else, at once even at night, and points at the settings', async () => {
    const world = await build()

    world.hook.notify(accepted())
    await world.hook.idle()

    expect(world.mailer.sent.map((mail) => mail.to)).toEqual(['hote@example.test'])
    expect(world.mailer.sent[0]?.text).toContain(
      `Marie Dupont a accepté de modérer «${NBSP}Camille et Sacha${NBSP}».`,
    )
    expect(world.mailer.sent[0]?.text).toContain(
      'https://photos.example.test/admin/events/camille-et-sacha/settings\n',
    )
  })

  it('writes in the language of the client', async () => {
    const world = await build({ client: { locale: 'en' } })

    world.hook.notify(accepted())
    await world.hook.idle()

    expect(world.mailer.sent[0]?.subject).toBe('An invitation was accepted for "Camille et Sacha"')
  })

  it('does not wait: notify returns before the mail is sent', async () => {
    const world = await build()

    world.hook.notify(accepted())

    expect(world.mailer.sent).toEqual([])
    await world.hook.idle()
    expect(world.mailer.sent).toHaveLength(1)
  })

  it('is not written when the inviter is unknown, is the one who accepted, or is no longer an owner of the event', async () => {
    const unknown = await build()
    unknown.hook.notify(accepted({ createdBy: null }))
    await unknown.hook.idle()

    const same = await build()
    same.hook.notify(accepted({ createdBy: HOST, acceptedBy: HOST }))
    await same.hook.idle()

    const demoted = await build()
    // The inviter has become a moderator since.
    await demoted.memberships.grant({
      eventId: WEDDING,
      userId: HOST,
      role: 'moderator',
      grantedAt: AT,
    })
    demoted.hook.notify(accepted())
    await demoted.hook.idle()

    const gone = await build()
    gone.hook.notify(accepted({ createdBy: asUserId('user-gone') }))
    await gone.hook.idle()

    expect([unknown, same, demoted, gone].flatMap((world) => world.mailer.sent)).toEqual([])
  })

  it('is not written to an inviter who switched the event family off, and the replies switch changes nothing', async () => {
    const off = await build()
    await off.preferences.save(HOST, { event: false })
    off.hook.notify(accepted())
    await off.hook.idle()
    expect(off.mailer.sent).toEqual([])

    const rsvpOff = await build()
    await rsvpOff.preferences.save(HOST, { rsvp: false })
    rsvpOff.hook.notify(accepted())
    await rsvpOff.hook.idle()
    expect(rsvpOff.mailer.sent).toHaveLength(1)
  })

  it('takes one place in the day budget, and is dropped when the day is full', async () => {
    const room = await build({ budgetMax: 2 })
    room.hook.notify(accepted())
    await room.hook.idle()
    expect(room.mailer.sent).toHaveLength(1)
    expect(await room.budget.used('2026-11-28')).toBe(1)

    const full = await build({ budgetMax: 1 })
    await full.budget.count('2026-11-28', 1)
    full.hook.notify(accepted())
    await full.hook.idle()
    expect(full.mailer.sent).toEqual([])
    expect(await full.budget.used('2026-11-28')).toBe(1)
  })

  it('sends nothing with HOST_MAIL_NOTICES=off or without a relay, and for an event that is gone, down, of a suspended client or of a client being closed', async () => {
    const off = await build({ hostMailNotices: false })
    off.hook.notify(accepted())
    await off.hook.idle()

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
    none.hook.notify(accepted())
    await none.hook.idle()

    const gone = await build({ seedEvent: false })
    gone.hook.notify(accepted())
    await gone.hook.idle()

    const down = await build()
    await down.events.setTakenDown(WEDDING, NOW)
    down.hook.notify(accepted())
    await down.hook.idle()

    const suspended = await build({ client: { suspendedAt: AT } })
    suspended.hook.notify(accepted())
    await suspended.hook.idle()

    const closing = await build({ client: { purgeAfter: new Date('2027-06-01T00:00:00.000Z') } })
    closing.hook.notify(accepted())
    await closing.hook.idle()

    expect(sent).toEqual([])
    expect(
      [off, none, gone, down, suspended, closing].flatMap((world) => world.mailer.sent),
    ).toEqual([])
  })

  it('names the invited address, not the name, when the name typed holds anything that reads as a link', async () => {
    for (const who of [
      'voir https://evil.example/x',
      'www.evil.example',
      'evil.example/promo',
      'a@b.co',
    ]) {
      const world = await build()

      world.hook.notify(accepted({ who }))
      await world.hook.idle()

      const text = world.mailer.sent[0]?.text ?? ''
      expect(text, who).toContain('marie@example.test a accepté de modérer')
      expect(text, who).not.toContain('evil')
      expect(text.match(/https?:\/\/\S+/g), who).toHaveLength(1)
    }
  })

  it('sends nothing to an inviter whose stored address cannot be written to', async () => {
    const world = await build()
    const hook = makeNotifyInvitationAccepted({
      ...world.deps,
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
    })

    hook.notify(accepted())
    await hook.idle()

    expect(world.mailer.sent).toEqual([])
  })

  it('logs a refusal of the relay by its code, never the address', async () => {
    const world = await build()
    world.mailer.failNextWith('rejected')

    world.hook.notify(accepted())
    await world.hook.idle()

    expect(
      world.logger.lines.find((entry) => entry.message === 'an invitation notice was not sent')
        ?.context,
    ).toEqual({ code: 'mail.rejected' })
    expect(JSON.stringify(world.logger.lines)).not.toContain('example.test')
  })

  it('never rejects: a failure is logged by the name of the error, not its message', async () => {
    const world = await build()
    const broken = makeNotifyInvitationAccepted({
      ...world.deps,
      memberships: {
        ownersToNotify: async () => {
          throw new TypeError('secret hote@example.test')
        },
      },
    })

    broken.notify(accepted())
    await broken.idle()

    expect(
      world.logger.lines.find((entry) => entry.message === 'an invitation notice failed')?.context,
    ).toEqual({ error: 'TypeError' })
    expect(JSON.stringify(world.logger.lines)).not.toContain('example.test')

    const plain = makeNotifyInvitationAccepted({
      ...world.deps,
      events: {
        findById: async () => {
          throw 'plain'
        },
      },
    })
    plain.notify(accepted())
    await plain.idle()
    expect(
      world.logger.lines.filter((entry) => entry.message === 'an invitation notice failed').at(-1)
        ?.context,
    ).toEqual({ error: 'unknown' })
  })
})
