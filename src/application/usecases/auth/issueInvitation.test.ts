import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { err } from '../../../domain/shared/result'
import {
  INVITATION_MAX_PER_ADDRESS_PER_HOUR,
  INVITATION_WINDOW_MS,
} from '../../../domain/users/accountToken'
import type { LogContext, Logger } from '../../ports/logger'
import { mailFailure, type Mailer } from '../../ports/mailer'
import { AT } from '../../testing/builders'
import { FakeAccountTokenRepository } from '../../testing/fakeAccountTokenRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeMailer } from '../../testing/fakeMailer'
import { FakeSecretTokens } from '../../testing/fakeSecretTokens'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import {
  makeIssueInvitation,
  type InvitedPlace,
  type IssueInvitationInput,
} from './issueInvitation'

const PUBLIC_URL = 'https://photos.example.test'
const NEWCOMER = 'nouveau@example.test'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** A box with no SMTP relay: the production `NullMailer`'s answer, written out. */
const nullMailer: Mailer = {
  canDeliver: false,
  send: async () => err(mailFailure('notConfigured')),
}

class RecordingLogger implements Logger {
  readonly lines: { level: string; message: string; context: LogContext }[] = []

  private record(level: string, message: string, context: LogContext = {}): void {
    this.lines.push({ level, message, context })
  }

  debug(message: string, context?: LogContext): void {
    this.record('debug', message, context)
  }
  info(message: string, context?: LogContext): void {
    this.record('info', message, context)
  }
  warn(message: string, context?: LogContext): void {
    this.record('warn', message, context)
  }
  error(message: string, context?: LogContext): void {
    this.record('error', message, context)
  }
  child(): Logger {
    return this
  }

  get everything(): string {
    return JSON.stringify(this.lines)
  }
}

const EVENT_PLACE: InvitedPlace = {
  kind: 'event',
  eventId: asEventId('event-1'),
  role: 'moderator',
  name: 'Mariage de Camille',
}

const CLIENT_PLACE: InvitedPlace = {
  kind: 'client',
  clientId: asClientId('client-1'),
  role: 'owner',
  name: 'Camille et Sacha',
}

describe('issueInvitation', () => {
  let tokens: FakeAccountTokenRepository
  let secrets: FakeSecretTokens
  let mailer: FakeMailer
  let clock: FakeClock
  let logger: RecordingLogger
  let ids: SequentialIdGenerator

  const build = (withMailer: Mailer = mailer) =>
    makeIssueInvitation({
      tokens,
      secrets,
      mailer: withMailer,
      ids,
      clock,
      logger,
      publicUrl: PUBLIC_URL,
    })

  const invite = (overrides: Partial<IssueInvitationInput> = {}, withMailer: Mailer = mailer) =>
    build(withMailer)({
      email: NEWCOMER,
      locale: 'fr',
      place: EVENT_PLACE,
      createdBy: asUserId('user-host'),
      ...overrides,
    })

  beforeEach(() => {
    tokens = new FakeAccountTokenRepository()
      .withAccounts(asUserId('user-host'))
      .withEvents(asEventId('event-1'), asEventId('event-2'))
      .withClients(asClientId('client-1'))
    secrets = new FakeSecretTokens()
    mailer = new FakeMailer()
    clock = new FakeClock(AT)
    logger = new RecordingLogger()
    ids = new SequentialIdGenerator()
  })

  // ------------------------------------------------------------ by mail --

  describe('on a box that can send mail', () => {
    it('mails the address a link that carries a fresh token', async () => {
      const result = await invite()

      expect(result.ok).toBe(true)
      expect(mailer.sent).toHaveLength(1)
      expect(mailer.sent[0]?.to).toBe(NEWCOMER)
      expect(mailer.sent[0]?.text).toContain(`${PUBLIC_URL}/invite/secret-1`)
    })

    it('shows the inviter nothing to copy, since the link went where it was meant to', async () => {
      const result = await invite()

      expect(result.ok && result.value.delivery).toBe('mail')
      expect(result.ok && 'link' in result.value).toBe(false)
    })

    it('names the event in the mail, in the language of the page that asked', async () => {
      await invite({ locale: 'en' })

      expect(mailer.sent[0]?.text).toContain('Mariage de Camille')
      expect(mailer.sent[0]?.text).toContain('Hello,')
    })

    it('says a client owner is asked to manage a space', async () => {
      await invite({ place: CLIENT_PLACE, locale: 'en' })

      expect(mailer.sent[0]?.text).toContain('manage the EventSlide space "Camille et Sacha"')
    })

    it('records that the link travelled by mail, which is what lets accepting it prove the mailbox', async () => {
      await invite()

      expect(tokens.all[0]?.delivery).toBe('mail')
    })
  })

  // ---------------------------------------------------------- by copied link --

  describe('on a box with no mail relay', () => {
    it('hands the link to the inviter to pass on', async () => {
      const result = await invite({}, nullMailer)

      expect(result.ok && result.value.delivery).toBe('link')
      expect(result.ok && 'link' in result.value && result.value.link).toBe(
        `${PUBLIC_URL}/invite/secret-1`,
      )
    })

    it('records that the inviter held the link, so accepting it proves nothing about the mailbox', async () => {
      await invite({}, nullMailer)

      expect(tokens.all[0]?.delivery).toBe('link')
    })
  })

  describe.each(['rejected', 'transient'] as const)('when the relay answers %s', (reason) => {
    it('falls back to a link for the inviter rather than leaving an invitation nobody received', async () => {
      mailer.failNextWith(reason)

      const result = await invite()

      expect(result.ok && result.value.delivery).toBe('link')
      expect(result.ok && 'link' in result.value && result.value.link).toContain('/invite/secret-1')
    })

    it('records the link as copied, because the mail may or may not have arrived', async () => {
      mailer.failNextWith(reason)

      await invite()

      expect(tokens.all[0]?.delivery).toBe('link')
    })

    it('logs the failure by its code and nothing else', async () => {
      mailer.failNextWith(reason)

      await invite()

      expect(logger.lines).toEqual([
        {
          level: 'warn',
          message: 'an invitation mail was not sent',
          context: { code: `mail.${reason}` },
        },
      ])
    })
  })

  // ------------------------------------------------------------ the record --

  describe('the record it stores', () => {
    it('keeps the digest of the token and never the token', async () => {
      await invite()

      const [stored] = tokens.all
      expect(stored?.tokenDigest).toBe(secrets.digestOf('secret-1'))
      expect(JSON.stringify(stored)).not.toContain('secret-1')
    })

    it('is an invitation to the event, for an address, with no account behind it', async () => {
      await invite()

      expect(tokens.all[0]).toMatchObject({
        purpose: 'invitation',
        email: { value: NEWCOMER },
        userId: null,
        eventId: 'event-1',
        eventRole: 'moderator',
        clientId: null,
        clientRole: null,
        createdBy: 'user-host',
        requiresApproval: false,
      })
    })

    it('is an invitation to the client, with the role it grants there', async () => {
      await invite({ place: { ...CLIENT_PLACE, role: 'member' } })

      expect(tokens.all[0]).toMatchObject({
        purpose: 'invitation',
        eventId: null,
        eventRole: null,
        clientId: 'client-1',
        clientRole: 'member',
      })
    })

    it('lives a week, and tells the caller when it ends', async () => {
      const result = await invite()

      expect(tokens.all[0]?.expiresAt.getTime()).toBe(AT.getTime() + 7 * DAY)
      expect(result.ok && result.value.expiresAt.getTime()).toBe(AT.getTime() + 7 * DAY)
      expect(mailer.sent[0]?.text).toContain('7')
    })

    it('writes no approval requirement unless the caller asked for one', async () => {
      await invite({ place: CLIENT_PLACE })

      expect(tokens.all[0]?.requiresApproval).toBe(false)
    })

    it('writes the approval requirement the caller asked for, unapproved, so the link opens nothing yet', async () => {
      await invite({ place: CLIENT_PLACE, requiresApproval: true })

      expect(tokens.all[0]).toMatchObject({
        requiresApproval: true,
        approvedAt: null,
        approvedBy: null,
      })
    })

    it('hands back the id of the invitation it stored', async () => {
      const result = await invite()

      expect(result.ok && result.value.invitationId).toBe(tokens.all[0]?.id)
    })

    it('may come from nobody for a client, as a system provisioning does', async () => {
      await invite({ createdBy: null, place: CLIENT_PLACE })

      expect(tokens.all[0]?.createdBy).toBeNull()
    })

    it('may not come from nobody for an event, whose invitation is only honoured while its author owns it', async () => {
      const result = await invite({ createdBy: null })

      expect(!result.ok && result.error.code).toBe('invitation.inviterRequired')
      expect(!result.ok && result.error.kind).toBe('invalid')
      expect(mailer.sent).toHaveLength(0)
      expect(tokens.all).toHaveLength(0)
    })

    it('spends no slot of the hourly cap on an invitation it refuses for that', async () => {
      for (let attempt = 0; attempt < INVITATION_MAX_PER_ADDRESS_PER_HOUR * 2; attempt += 1) {
        await invite({ createdBy: null })
      }

      expect((await invite()).ok).toBe(true)
    })

    it('stores the address as an account would, lower-cased and trimmed', async () => {
      await invite({ email: '  Nouveau@Example.TEST ' })

      expect(tokens.all[0]?.email.value).toBe(NEWCOMER)
    })
  })

  // --------------------------------------------------------- re-inviting --

  describe('inviting an address a second time', () => {
    const live = (digestToken: string) =>
      tokens.findUsable(secrets.digestOf(digestToken), 'invitation', clock.now())

    it('replaces the earlier link to the same event, so a lost link can be cancelled', async () => {
      await invite()
      await invite()

      expect(await live('secret-1')).toBeNull()
      expect(await live('secret-2')).not.toBeNull()
    })

    it('leaves an invitation to another event alone', async () => {
      await invite()
      await invite({ place: { ...EVENT_PLACE, eventId: asEventId('event-2') } })

      expect(await live('secret-1')).not.toBeNull()
      expect(await live('secret-2')).not.toBeNull()
    })

    it('leaves an invitation to a client alone when the new one is to an event', async () => {
      await invite({ place: CLIENT_PLACE })
      await invite()

      expect(await live('secret-1')).not.toBeNull()
    })

    it('leaves another address alone', async () => {
      await invite({ email: 'autre@example.test' })
      await invite()

      expect(await live('secret-1')).not.toBeNull()
    })

    it('does not revoke the link it has just written', async () => {
      await invite()

      expect(await live('secret-1')).not.toBeNull()
    })
  })

  // ------------------------------------------------------------- the cap --

  describe('invitations to one address that arrive together', () => {
    /** A relay that takes a moment, which is what gives a second request time to count. */
    const slowMailer: Mailer = {
      canDeliver: true,
      send: async (mail) => {
        await new Promise((resolve) => setTimeout(resolve, 2))
        return mailer.send(mail)
      },
    }

    it('are held to the cap, not counted all at once before any is written', async () => {
      // The box builds the use case once and the queue lives in it, so these share one.
      const once = build(slowMailer)
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          once({
            email: NEWCOMER,
            locale: 'fr',
            place: EVENT_PLACE,
            createdBy: asUserId('user-host'),
          }),
        ),
      )

      expect(results.filter((result) => result.ok)).toHaveLength(
        INVITATION_MAX_PER_ADDRESS_PER_HOUR,
      )
      expect(mailer.sent).toHaveLength(INVITATION_MAX_PER_ADDRESS_PER_HOUR)
      expect(tokens.all).toHaveLength(INVITATION_MAX_PER_ADDRESS_PER_HOUR)
    })

    it('leave exactly one live link to the same event, the newest', async () => {
      const once = build(slowMailer)
      await Promise.all(
        Array.from({ length: 4 }, () =>
          once({
            email: NEWCOMER,
            locale: 'fr',
            place: EVENT_PLACE,
            createdBy: asUserId('user-host'),
          }),
        ),
      )

      const live = tokens.all.filter(
        (token) => token.revokedAt === null && token.consumedAt === null,
      )
      expect(live).toHaveLength(1)
      expect(live[0]?.id).toBe(tokens.all.at(-1)?.id)
    })

    it('do not make another address wait for them', async () => {
      const log: string[] = []
      const gated: Mailer = {
        canDeliver: true,
        send: async (mail) => {
          log.push(`start ${mail.to.value}`)
          await new Promise((resolve) => setTimeout(resolve, 20))
          log.push(`end ${mail.to.value}`)
          return mailer.send(mail)
        },
      }

      const once = build(gated)
      const to = (email: string) =>
        once({ email, locale: 'fr', place: EVENT_PLACE, createdBy: asUserId('user-host') })

      await Promise.all([to('lent@example.test'), to('rapide@example.test')])

      // The second address reached the relay before the first one finished: the queue is
      // per address, not one for the whole box.
      expect(log.slice(0, 2)).toEqual(['start lent@example.test', 'start rapide@example.test'])
      expect(mailer.sent.map((sent) => sent.to).sort()).toEqual([
        'lent@example.test',
        'rapide@example.test',
      ])
    })

    it('go on after one whose relay blew up, since the queue only orders them', async () => {
      let sends = 0
      const flaky: Mailer = {
        canDeliver: true,
        send: async (mail) => {
          sends += 1
          if (sends === 1) throw new Error('relay exploded')
          return mailer.send(mail)
        },
      }
      const once = build(flaky)
      const attempt = () =>
        once({
          email: NEWCOMER,
          locale: 'fr',
          place: EVENT_PLACE,
          createdBy: asUserId('user-host'),
        })

      const [first, second] = await Promise.allSettled([attempt(), attempt()])

      expect(first.status).toBe('rejected')
      expect(second.status).toBe('fulfilled')
      expect(mailer.sent).toHaveLength(1)
    })
  })

  describe('the hourly cap on one address', () => {
    it('lets an address be invited up to the cap', async () => {
      for (let attempt = 0; attempt < INVITATION_MAX_PER_ADDRESS_PER_HOUR; attempt += 1) {
        expect((await invite()).ok).toBe(true)
      }

      expect(mailer.sent).toHaveLength(INVITATION_MAX_PER_ADDRESS_PER_HOUR)
    })

    it('refuses the next one, sends nothing and writes nothing', async () => {
      for (let attempt = 0; attempt < INVITATION_MAX_PER_ADDRESS_PER_HOUR; attempt += 1) {
        await invite()
      }
      const written = tokens.all.length

      const result = await invite()

      expect(!result.ok && result.error.kind).toBe('rateLimited')
      expect(!result.ok && result.error.code).toBe('invitation.tooManyForAddress')
      expect(mailer.sent).toHaveLength(INVITATION_MAX_PER_ADDRESS_PER_HOUR)
      expect(tokens.all).toHaveLength(written)
    })

    it('counts invitations to the address whatever they were for', async () => {
      for (let attempt = 0; attempt < INVITATION_MAX_PER_ADDRESS_PER_HOUR; attempt += 1) {
        await invite({
          place:
            attempt % 2 === 0 ? EVENT_PLACE : { ...EVENT_PLACE, eventId: asEventId('event-2') },
        })
      }

      expect((await invite({ place: CLIENT_PLACE })).ok).toBe(false)
    })

    it('does not count another address', async () => {
      for (let attempt = 0; attempt < INVITATION_MAX_PER_ADDRESS_PER_HOUR; attempt += 1) {
        await invite()
      }

      expect((await invite({ email: 'autre@example.test' })).ok).toBe(true)
    })

    it('forgets them when the hour is over', async () => {
      for (let attempt = 0; attempt < INVITATION_MAX_PER_ADDRESS_PER_HOUR; attempt += 1) {
        await invite()
      }
      clock.advance(INVITATION_WINDOW_MS + 1)

      expect((await invite()).ok).toBe(true)
    })

    it('still counts a link that was replaced, since its mail went out', async () => {
      for (let attempt = 0; attempt < INVITATION_MAX_PER_ADDRESS_PER_HOUR; attempt += 1) {
        await invite()
      }

      // Five written, one still alive: the four replaced ones are in the count.
      expect((await invite()).ok).toBe(false)
    })
  })

  // --------------------------------------------------------- what it refuses --

  describe('an address that is not one', () => {
    it.each(['', '   ', 'not an address'])(
      'refuses %j, sends nothing and writes nothing',
      async (email) => {
        const result = await invite({ email })

        expect(result.ok).toBe(false)
        expect(mailer.sent).toHaveLength(0)
        expect(tokens.all).toHaveLength(0)
      },
    )
  })

  describe('a secret source that returns something the table would refuse', () => {
    it('sends nothing and writes nothing, since a mail must not carry a link to a record that cannot exist', async () => {
      const broken = {
        mint: () => ({ token: 'secret-1', digest: 'not a sha-256' }),
        digestOf: (token: string) => token,
        verify: () => true,
      }

      const result = await makeIssueInvitation({
        tokens,
        secrets: broken,
        mailer,
        ids,
        clock,
        logger,
        publicUrl: PUBLIC_URL,
      })({ email: NEWCOMER, locale: 'fr', place: EVENT_PLACE, createdBy: asUserId('user-host') })

      expect(!result.ok && result.error.code).toBe('accountToken.digestInvalid')
      expect(mailer.sent).toHaveLength(0)
      expect(tokens.all).toHaveLength(0)
    })
  })

  // ------------------------------------------------------------ housekeeping --

  it('deletes the rows that expired more than a day ago, since they hold an address', async () => {
    await invite()
    clock.advance(7 * DAY + DAY + 1)

    await invite({ email: 'autre@example.test' })

    expect(tokens.all.map((token) => token.email.value)).toEqual(['autre@example.test'])
  })

  // -------------------------------------------------------------- the logs --

  it('logs neither the address, nor the token, nor the link, nor the name of the target', async () => {
    mailer.failNextWith('rejected')

    await invite({ email: 'secret.address@example.test' })

    expect(logger.everything).not.toContain('secret.address')
    expect(logger.everything).not.toContain('secret-1')
    expect(logger.everything).not.toContain('/invite/')
    expect(logger.everything).not.toContain('Mariage de Camille')
  })
})
