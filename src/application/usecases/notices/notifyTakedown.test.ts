import { describe, expect, it } from 'vitest'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
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
import { makeNotifyTakedown, type NotifyTakedownDeps, type TakedownAct } from './notifyTakedown'

/**
 * A4 (spec 32, section 3.4): the mail about what the operator did. The event of the Camille wedding belongs to a client whose
 * owners are the host and a co-host, whose contact address is the host's own, and who has a member (not an owner).
 */

const EVENT = asEventId('evt-wedding')
const CLIENT = asClientId('client-1')
const HOST = asUserId('user-host')
const CO_HOST = asUserId('user-cohost')
const MEMBER = asUserId('user-member')
const NOW = new Date('2026-11-28T03:00:00.000Z')
const CONTACT = (() => {
  const made = EmailAddress.create('contact@operateur.example')
  if (!made.ok) throw new Error('fixture')
  return made.value
})()

const eventAct = (
  patch: Partial<Extract<TakedownAct, { eventId: unknown }>> = {},
): TakedownAct => ({
  kind: 'photo',
  eventId: EVENT,
  reason: 'Contenu signalé.',
  at: NOW,
  ...patch,
})
const clientAct = (
  patch: Partial<Extract<TakedownAct, { clientId: unknown }>> = {},
): TakedownAct => ({
  kind: 'clientSuspended',
  clientId: CLIENT,
  reason: null,
  at: NOW,
  ...patch,
})

const build = async (
  options: {
    budgetMax?: number | null
    mailer?: Mailer
    contact?: EmailAddress | null
    clientContact?: string | null
    locale?: 'fr' | 'en'
    disabledOwner?: boolean
    seedEvent?: boolean
    seedClient?: boolean
  } = {},
) => {
  const users = new FakeUserRepository().seed(
    aUser({ id: HOST, email: 'hote@example.test' }),
    aUser({ id: CO_HOST, email: 'cohote@example.test' }),
    aUser({ id: MEMBER, email: 'membre@example.test' }),
  )
  const clients = new FakeClientRepository()
  if (options.seedClient !== false) {
    clients.seed(
      aClient({
        id: 'client-1',
        name: 'Atelier Photo Camille',
        contactEmail:
          options.clientContact === undefined ? 'hote@example.test' : options.clientContact,
        locale: options.locale ?? 'fr',
      }),
    )
    await clients.grantMember({ clientId: CLIENT, userId: HOST, role: 'owner', grantedAt: AT })
    await clients.grantMember({ clientId: CLIENT, userId: CO_HOST, role: 'owner', grantedAt: AT })
    await clients.grantMember({ clientId: CLIENT, userId: MEMBER, role: 'member', grantedAt: AT })
  }
  const events = new FakeEventRepository({ clients })
  if (options.seedEvent !== false) {
    events.seed(
      anEvent({
        id: EVENT,
        slug: 'camille-et-sacha',
        name: 'Camille et Sacha',
        ...(options.seedClient === false ? {} : { clientId: 'client-1' }),
      }),
    )
  }
  const preferences = new FakeMailPreferenceRepository().withUsers(HOST, CO_HOST, MEMBER)
  const memberships = new FakeMembershipRepository({ users, mailPreferences: preferences }).seed(
    { eventId: EVENT, userId: HOST, role: 'owner', grantedAt: AT },
    { eventId: EVENT, userId: CO_HOST, role: 'owner', grantedAt: new Date(AT.getTime() + 1) },
    { eventId: EVENT, userId: MEMBER, role: 'moderator', grantedAt: AT },
  )
  const budget = new FakeMailBudget(options.budgetMax ?? null)
  const mailer = new FakeMailer()
  const logger = new CapturingLogger()
  const deps: NotifyTakedownDeps = {
    events,
    clients,
    users,
    memberships,
    budget,
    mailer: options.mailer ?? mailer,
    clock: new FakeClock(NOW),
    logger,
    operatorContact: options.contact === undefined ? CONTACT : options.contact,
  }
  return {
    hook: makeNotifyTakedown(deps),
    deps,
    mailer,
    budget,
    logger,
    preferences,
    users,
    clients,
  }
}

const sentTo = (mailer: FakeMailer): string[] => mailer.sent.map((mail) => mail.to).sort()

describe('notifyTakedown (A4)', () => {
  it('tells the active owners of the event that a photograph was removed, by the event name and the day, not a moderator', async () => {
    const world = await build()

    world.hook.notify(eventAct())
    await world.hook.idle()

    expect(sentTo(world.mailer)).toEqual(['cohote@example.test', 'hote@example.test'])
    const text = world.mailer.sent[0]?.text ?? ''
    expect(text).toContain('Une photo de l’évènement')
    expect(text).toContain('Camille et Sacha')
    expect(text).toContain('Le 28 novembre 2026.')
    expect(text).toContain('Contenu signalé.')
    expect(world.mailer.sent[0]?.replyTo).toBe('contact@operateur.example')
  })

  it('tells at once, not noted, and does not wait: notify returns before anything is sent', async () => {
    const world = await build()

    world.hook.notify(eventAct())

    expect(world.mailer.sent).toEqual([])
    await world.hook.idle()
    expect(world.mailer.sent).toHaveLength(2)
  })

  it('says a guestbook message and the whole event in their own words', async () => {
    const world = await build()

    world.hook.notify(eventAct({ kind: 'guestbook' }))
    world.hook.notify(eventAct({ kind: 'event' }))
    await world.hook.idle()

    const texts = world.mailer.sent.map((mail) => mail.text).join('\n')
    expect(texts).toContain('Un message du livre d’or')
    expect(texts).toContain(
      'a été retiré par l’opérateur de ce serveur : il n’est plus accessible.',
    )
  })

  it('writes in the language of the event’s client', async () => {
    const world = await build({ locale: 'en' })

    world.hook.notify(eventAct())
    await world.hook.idle()

    expect(world.mailer.sent[0]?.subject).toBe('A photo was removed from "Camille et Sacha"')
  })

  it('writes in the wall language of an event with no client, to its owners', async () => {
    const world = await build({ seedClient: false })

    world.hook.notify(eventAct())
    await world.hook.idle()

    expect(sentTo(world.mailer)).toEqual(['cohote@example.test', 'hote@example.test'])
    expect(world.mailer.sent[0]?.subject).toContain('Une photo a été retirée')
  })

  it("tells a client's owners and its contact address once each: the owner who is also the contact gets one mail", async () => {
    const world = await build({ clientContact: 'hote@example.test' })

    world.hook.notify(clientAct())
    await world.hook.idle()

    expect(sentTo(world.mailer)).toEqual(['cohote@example.test', 'hote@example.test'])
  })

  it('adds the contact address when it is nobody who owns the space, and never writes to a plain member', async () => {
    const world = await build({ clientContact: 'compta@example.test' })

    world.hook.notify(clientAct({ kind: 'clientResumed' }))
    await world.hook.idle()

    expect(sentTo(world.mailer)).toEqual([
      'cohote@example.test',
      'compta@example.test',
      'hote@example.test',
    ])
    expect(world.mailer.sent[0]?.text).not.toContain('contester')
  })

  it('deduplicates addresses that differ only by case', async () => {
    const world = await build({ clientContact: 'HOTE@example.test' })

    world.hook.notify(clientAct())
    await world.hook.idle()

    expect(sentTo(world.mailer)).toEqual(['cohote@example.test', 'hote@example.test'])
  })

  it('leaves out an owner whose account is switched off', async () => {
    const world = await build({ clientContact: null })
    const cohost = await world.users.findById(CO_HOST)
    if (cohost === null) throw new Error('fixture')
    await world.users.save(cohost.disable(NOW))

    world.hook.notify(clientAct())
    await world.hook.idle()

    expect(sentTo(world.mailer)).toEqual(['hote@example.test'])
  })

  it('names the day the albums go when a space is put on the way out', async () => {
    const world = await build()
    const client = await world.clients.findById(CLIENT)
    if (client === null) throw new Error('fixture')
    await world.clients.save(client.offboard(NOW, new Date('2027-01-10T08:00:00.000Z')))

    world.hook.notify(clientAct({ kind: 'clientOffboarded' }))
    await world.hook.idle()

    expect(world.mailer.sent[0]?.text).toContain('Vos albums seront supprimés le 10 janvier 2027.')
  })

  it("has no family: the owners' switches change nothing, and it is not stopped by anything but the absence of a relay", async () => {
    const world = await build()
    await world.preferences.save(HOST, { rsvp: false, event: false })

    world.hook.notify(eventAct())
    await world.hook.idle()

    expect(sentTo(world.mailer)).toEqual(['cohote@example.test', 'hote@example.test'])

    const none = makeNotifyTakedown({
      ...world.deps,
      mailer: {
        canDeliver: false,
        send: async () => {
          throw new Error('no relay')
        },
      },
    })
    none.notify(eventAct())
    await none.idle()
    expect(world.mailer.sent).toHaveLength(2)
  })

  it('counts its mails in the day budget and is never refused by it', async () => {
    const world = await build({ budgetMax: 1 })
    await world.budget.count('2026-11-28', 1)

    world.hook.notify(eventAct())
    await world.hook.idle()

    expect(world.mailer.sent).toHaveLength(2)
    expect(await world.budget.used('2026-11-28')).toBe(3)
  })

  it('carries no reply address when the operator has none, and says to write to the operator', async () => {
    const world = await build({ contact: null })

    world.hook.notify(eventAct())
    await world.hook.idle()

    expect(world.mailer.sent[0]?.replyTo).toBeNull()
    expect(world.mailer.sent[0]?.text).toContain('écrivez à l’opérateur de ce serveur')
  })

  it("says nothing of a guest: it never reads one, and the mail holds the event name and the operator's words only", async () => {
    const world = await build()

    world.hook.notify(eventAct({ reason: null }))
    await world.hook.idle()

    const text = world.mailer.sent[0]?.text ?? ''
    expect(text).not.toMatch(/Léa|Martin|invité/)
    expect(text).not.toMatch(/https?:\/\//)
  })

  it('sends nothing for an event or a client that is gone, or with nobody to write to', async () => {
    const gone = await build({ seedEvent: false })
    gone.hook.notify(eventAct())
    await gone.hook.idle()

    const noClient = await build({ seedClient: false })
    noClient.hook.notify(clientAct())
    await noClient.hook.idle()

    const nobody = await build({ clientContact: null })
    for (const userId of [HOST, CO_HOST]) {
      await nobody.clients.revokeMember(CLIENT, userId)
    }
    nobody.hook.notify(clientAct())
    await nobody.hook.idle()

    expect([gone, noClient, nobody].flatMap((world) => world.mailer.sent)).toEqual([])
    expect(await nobody.budget.used('2026-11-28')).toBe(0)
  })

  it('skips a stored address that cannot be written to and writes to the others', async () => {
    const world = await build()
    const hook = makeNotifyTakedown({
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
          {
            userId: CO_HOST,
            email: 'cohote@example.test',
            mail: { rsvp: true, event: true },
            rsvpDigest: false,
            rsvpDigestAt: null,
          },
        ],
      },
    })

    hook.notify(eventAct())
    await hook.idle()

    expect(sentTo(world.mailer)).toEqual(['cohote@example.test'])
  })

  it('logs a refusal of the relay by its code, never the address, and goes on to the next recipient', async () => {
    const world = await build()
    world.mailer.failNextWith('rejected')

    world.hook.notify(eventAct())
    await world.hook.idle()

    expect(world.mailer.sent).toHaveLength(1)
    expect(
      world.logger.lines.find((entry) => entry.message === 'a takedown notice was not sent')
        ?.context,
    ).toEqual({ kind: 'photo', code: 'mail.rejected' })
    expect(JSON.stringify(world.logger.lines)).not.toContain('example.test')
  })

  it('never rejects: a failure is logged by the name of the error, not its message', async () => {
    const world = await build()
    const broken = makeNotifyTakedown({
      ...world.deps,
      events: {
        findById: async () => {
          throw new TypeError('secret hote@example.test')
        },
      },
    })

    broken.notify(eventAct())
    await broken.idle()

    expect(
      world.logger.lines.find((entry) => entry.message === 'a takedown notice failed')?.context,
    ).toEqual({ kind: 'photo', error: 'TypeError' })
    expect(JSON.stringify(world.logger.lines)).not.toContain('example.test')

    const plain = makeNotifyTakedown({
      ...world.deps,
      events: {
        findById: async () => {
          throw 'plain'
        },
      },
    })
    plain.notify(eventAct())
    await plain.idle()
    expect(
      world.logger.lines.filter((entry) => entry.message === 'a takedown notice failed').at(-1)
        ?.context,
    ).toEqual({ kind: 'photo', error: 'unknown' })
  })
})
