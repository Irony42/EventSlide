import { describe, expect, it } from 'vitest'
import { asClientId, asUserId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { err } from '../../../domain/shared/result'
import { AT, aClient, aUser } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeMailBudget } from '../../testing/fakeMailBudget'
import { FakeMailer } from '../../testing/fakeMailer'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { mailFailure, type Mailer } from '../../ports/mailer'
import { makeAccountNotice } from './accountNotice'

const HOST = asUserId('user-1')
const CONTACT = (() => {
  const made = EmailAddress.create('contact@example.test')
  if (!made.ok) throw new Error('fixture')
  return made.value
})()

const build = (
  over: { mailer?: Mailer; contact?: EmailAddress | null; users?: FakeUserRepository } = {},
) => {
  const users =
    over.users ?? new FakeUserRepository().seed(aUser({ id: 'user-1', email: 'hote@example.test' }))
  const clients = new FakeClientRepository()
  const mailer = new FakeMailer()
  const budget = new FakeMailBudget()
  const logger = new CapturingLogger()
  const notice = makeAccountNotice({
    users,
    clients,
    mailer: over.mailer ?? mailer,
    budget,
    clock: new FakeClock(AT),
    logger,
    publicUrl: 'https://photos.example.test',
    operatorContact: over.contact === undefined ? null : over.contact,
  })
  const joins = async (id: string, locale: 'fr' | 'en' | 'de', grantedAt: Date) => {
    clients.seed(aClient({ id, locale }))
    await clients.grantMember({
      clientId: asClientId(id),
      userId: HOST,
      role: 'member',
      grantedAt,
    })
  }
  return { notice, mailer, budget, logger, users, clients, joins }
}

describe('accountNotice', () => {
  it('sends the mail to the account address, with the reset link, and says nothing of who or where', async () => {
    const world = build()

    world.notice.notify(HOST, 'passwordChanged')
    await world.notice.idle()

    expect(world.mailer.sent).toHaveLength(1)
    expect(world.mailer.sent[0]?.to).toBe('hote@example.test')
    expect(world.mailer.sent[0]?.text).toContain('https://photos.example.test/password/forgot')
  })

  it('writes in the language of the oldest client of the account, else French', async () => {
    const none = build()
    none.notice.notify(HOST, 'totpEnabled')
    await none.notice.idle()
    expect(none.mailer.sent[0]?.subject).toBe('La vérification en deux étapes est activée')

    const world = build()
    await world.joins('client-new', 'de', new Date(AT.getTime() + 1000))
    await world.joins('client-old', 'en', AT)
    world.notice.notify(HOST, 'totpEnabled')
    await world.notice.idle()
    expect(world.mailer.sent[0]?.subject).toBe('Two-step verification is on')
  })

  it('falls back to French when the oldest client cannot be read', async () => {
    const world = build()
    const notice = makeAccountNotice({
      users: world.users,
      clients: {
        membershipsForUser: async () => [
          { clientId: asClientId('gone'), userId: HOST, role: 'member', grantedAt: AT },
        ],
        findById: async () => null,
      },
      mailer: world.mailer,
      budget: world.budget,
      clock: new FakeClock(AT),
      logger: world.logger,
      publicUrl: 'https://photos.example.test',
      operatorContact: null,
    })

    notice.notify(HOST, 'totpEnabled')
    await notice.idle()

    expect(world.mailer.sent[0]?.subject).toBe('La vérification en deux étapes est activée')
  })

  it('answers at the operator contact for a disabling and an enabling, and for no other act', async () => {
    const world = build({ contact: CONTACT })

    world.notice.notify(HOST, 'accountDisabled')
    world.notice.notify(HOST, 'accountEnabled')
    await world.notice.idle()

    const byKind = new Map(world.mailer.sent.map((mail) => [mail.subject, mail.replyTo]))
    expect(byKind.get('Votre compte EventSlide a été désactivé')).toBe('contact@example.test')
    expect(byKind.get('Votre compte EventSlide a été réactivé')).toBe('contact@example.test')
  })

  it('reads and sends nothing without a relay', async () => {
    let read = false
    const users = new FakeUserRepository().seed(aUser({ id: 'user-1' }))
    const spy = {
      findById: async (id: Parameters<typeof users.findById>[0]) => (
        (read = true),
        users.findById(id)
      ),
    }
    const sent: unknown[] = []
    const notice = makeAccountNotice({
      users: spy,
      clients: new FakeClientRepository(),
      mailer: {
        canDeliver: false,
        send: async (mail) => (sent.push(mail), err(mailFailure('notConfigured'))),
      },
      budget: new FakeMailBudget(),
      clock: new FakeClock(AT),
      logger: new CapturingLogger(),
      publicUrl: 'https://photos.example.test',
      operatorContact: null,
    })

    notice.notify(HOST, 'passwordChanged')
    await notice.idle()

    expect([read, sent]).toEqual([false, []])
  })

  it('counts the mail in the day budget', async () => {
    const world = build()

    world.notice.notify(HOST, 'passwordChanged')
    await world.notice.idle()

    expect(await world.budget.used(AT.toISOString().slice(0, 10))).toBe(1)
  })

  it('is never refused by a budget that is spent: it only counts', async () => {
    const world = build()
    const tight = new FakeMailBudget(0)
    const notice = makeAccountNotice({
      users: world.users,
      clients: world.clients,
      mailer: world.mailer,
      budget: tight,
      clock: new FakeClock(AT),
      logger: world.logger,
      publicUrl: 'https://photos.example.test',
      operatorContact: null,
    })

    notice.notify(HOST, 'passwordChanged')
    await notice.idle()

    expect(world.mailer.sent).toHaveLength(1)
  })

  it('reads the address at prepare and sends it later, after the account is gone', async () => {
    const world = build()
    const prepared = await world.notice.prepare(HOST, 'accountDeleted')
    await world.users.delete(HOST)

    prepared.send()
    await world.notice.idle()

    expect(world.mailer.sent[0]?.to).toBe('hote@example.test')
    expect(world.mailer.sent[0]?.text).not.toContain('password/forgot')
  })

  it('sends nothing for an account that does not exist', async () => {
    const world = build()

    world.notice.notify(asUserId('nobody'), 'passwordChanged')
    await world.notice.idle()

    expect(world.mailer.sent).toEqual([])
  })

  it('never rejects and logs the kind and the code, never the address, when the relay refuses', async () => {
    const world = build()
    world.mailer.failNextWith('transient')

    world.notice.notify(HOST, 'passwordChanged')
    await world.notice.idle()

    const logged = JSON.stringify(world.logger.lines)
    expect(logged).toContain('an account notice was not sent')
    expect(logged).toContain('passwordChanged')
    expect(logged).not.toContain('example.test')
  })

  it('sends the mail even when the budget cannot be written, and logs the failure by name only', async () => {
    const world = build()
    const notice = makeAccountNotice({
      users: world.users,
      clients: world.clients,
      mailer: world.mailer,
      budget: {
        count: async () => {
          throw new Error('cannot write hote@example.test')
        },
      },
      clock: new FakeClock(AT),
      logger: world.logger,
      publicUrl: 'https://photos.example.test',
      operatorContact: null,
    })

    notice.notify(HOST, 'passwordChanged')
    await notice.idle()

    expect(world.mailer.sent).toHaveLength(1)
    expect(JSON.stringify(world.logger.lines)).toContain('an account notice failed')
    expect(JSON.stringify(world.logger.lines)).not.toContain('example.test')
  })

  it('catches a failure while reading the account and while sending, as an Error or as text', async () => {
    const reading = build({
      users: {
        findById: async () => {
          throw new Error('database is locked')
        },
      } as unknown as FakeUserRepository,
    })
    reading.notice.notify(HOST, 'passwordChanged')
    await reading.notice.idle()
    expect(JSON.stringify(reading.logger.lines)).toContain('Error')
    expect(JSON.stringify(reading.logger.lines)).not.toContain('database is locked')

    const sending = build({
      mailer: {
        canDeliver: true,
        send: async () => {
          throw 'plain'
        },
      },
    })
    sending.notice.notify(HOST, 'passwordChanged')
    await sending.notice.idle()
    expect(JSON.stringify(sending.logger.lines)).toContain('unknown')
  })

  it('does not make the caller wait: notify returns at once, the mail is a completion', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = build({
      mailer: {
        canDeliver: true,
        send: async () => {
          await gate
          return { ok: true, value: undefined }
        },
      },
    })

    const returned = slow.notice.notify(HOST, 'passwordChanged')
    expect(returned).toBeUndefined()

    release()
    await slow.notice.idle()
  })
})
