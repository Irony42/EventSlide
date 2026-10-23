import { beforeEach, describe, expect, it } from 'vitest'
import type { NewClientDefaults } from '../../../domain/clients/newClientCeilings'
import { asClientId, asUserId } from '../../../domain/shared/ids'
import { err } from '../../../domain/shared/result'
import { INVITATION_MAX_PER_ADDRESS_PER_HOUR } from '../../../domain/users/accountToken'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { Logger } from '../../ports/logger'
import type { AuditRecorder } from '../../ports/auditLog'
import { mailFailure, type Mailer } from '../../ports/mailer'
import { AT, aUser, anAccountToken } from '../../testing/builders'
import { FakeAccountTokenRepository } from '../../testing/fakeAccountTokenRepository'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeMailer } from '../../testing/fakeMailer'
import { FakeSecretTokens } from '../../testing/fakeSecretTokens'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeIssueInvitation, type IssueInvitation } from '../auth/issueInvitation'
import { makeCreateClient } from './createClient'
import { makeProvisionClientOwner, type ProvisionClientOwnerInput } from './provisionClientOwner'

const PUBLIC_URL = 'https://photos.example.test'
const OWNER = 'proprietaire@example.test'
const OPERATOR = 'user-operator'

const quietLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quietLogger,
}

/** A box that set no `NEW_CLIENT_*`: no ceiling, clips allowed. What every self-hosted box has. */
const NO_DEFAULTS: NewClientDefaults = {
  maxEvents: null,
  maxEventsPerPeriod: null,
  maxTotalBytes: null,
  maxEventQuotaBytes: null,
  maxRetentionDays: null,
  maxLiveDays: null,
  clipsAllowed: true,
}

/** A tier a hosted box might configure: every ceiling set, the two byte counts told apart. */
const A_TIER: NewClientDefaults = {
  maxEvents: 1,
  maxEventsPerPeriod: 6,
  maxTotalBytes: 20_000_000_000,
  maxEventQuotaBytes: 5_000_000_000,
  maxRetentionDays: 30,
  maxLiveDays: 3,
  clipsAllowed: true,
}

const nullMailer: Mailer = {
  canDeliver: false,
  send: async () => err(mailFailure('notConfigured')),
}

describe('provisionClientOwner', () => {
  let clients: FakeClientRepository
  let tokens: FakeAccountTokenRepository
  let users: FakeUserRepository
  let mailer: FakeMailer
  let audit: FakeAuditLog
  let clock: FakeClock
  let ids: SequentialIdGenerator
  let issueWith: (mailerToUse: Mailer) => IssueInvitation

  const provision = (
    overrides: Partial<ProvisionClientOwnerInput> = {},
    deps: {
      mailer?: Mailer
      issue?: IssueInvitation
      clientsPort?: FakeClientRepository
      defaults?: NewClientDefaults
      audit?: AuditRecorder
      ids?: SequentialIdGenerator
    } = {},
  ) =>
    makeProvisionClientOwner({
      createClient: makeCreateClient({ clients, ids: deps.ids ?? ids, clock }),
      issueInvitation: deps.issue ?? issueWith(deps.mailer ?? mailer),
      clients: deps.clientsPort ?? clients,
      newClientDefaults: deps.defaults ?? NO_DEFAULTS,
      audit: deps.audit ?? audit,
      clock,
    })({
      clientName: 'Camille et Sacha',
      ownerEmail: OWNER,
      locale: 'fr',
      createdBy: asUserId(OPERATOR),
      ...overrides,
    })

  const allClients = async () => (await clients.list({ limit: 50 })).items

  beforeEach(() => {
    clients = new FakeClientRepository()
    users = new FakeUserRepository().seed(aUser({ id: OPERATOR, email: 'operateur@example.test' }))
    tokens = new FakeAccountTokenRepository().withAccounts(asUserId(OPERATOR))
    mailer = new FakeMailer()
    audit = new FakeAuditLog().withAccounts(asUserId(OPERATOR))
    clock = new FakeClock(AT)
    ids = new SequentialIdGenerator()
    const secrets = new FakeSecretTokens()
    issueWith = (mailerToUse) =>
      makeIssueInvitation({
        tokens,
        secrets,
        mailer: mailerToUse,
        ids,
        clock,
        logger: quietLogger,
        publicUrl: PUBLIC_URL,
      })
    // The ids the sequential generator will hand out, plus one the cap test pre-fills.
    tokens.withClients(asClientId('client-1'), asClientId('client-2'), asClientId('client-9'))
  })

  describe('the client it opens', () => {
    it('has the name it was given, the owner as its contact, and the language it was asked for', async () => {
      const result = await provision({ locale: 'de' })

      const [client] = await allClients()
      expect(result.ok && result.value.clientId).toBe(client?.id)
      expect(client?.name.value).toBe('Camille et Sacha')
      expect(client?.contactEmail?.value).toBe(OWNER)
      expect(client?.locale).toBe('de')
    })

    it('has no member and no event: its owner arrives by accepting', async () => {
      const result = await provision()

      const clientId = result.ok ? result.value.clientId : asClientId('none')
      expect(await clients.memberRole(clientId, asUserId(OPERATOR))).toBeNull()
      expect(clients.eventsOf(clientId)).toEqual([])
      expect(await clients.deleteIfEmpty(clientId)).toBe(true)
    })

    it('writes no account for the owner, so nothing at that address can be squatted or signed in to', async () => {
      await provision()

      expect(await users.findByEmail(emailOf(OWNER))).toBeNull()
      expect(await users.isEmpty()).toBe(false)
      expect(await users.findById(asUserId(OPERATOR))).not.toBeNull()
    })

    it('starts unlimited when no ceiling is given, and keeps the ones that are', async () => {
      await provision()
      await provision({
        clientName: 'Autre',
        ownerEmail: 'autre@example.test',
        ceilings: { maxEvents: 3 },
      })

      const [limited, unlimited] = await allClients()
      expect(limited?.ceilings.toProps().maxEvents).toBe(3)
      expect(unlimited?.ceilings.toProps().maxEvents).toBeNull()
    })
  })

  describe('the ceilings it starts with (NEW_CLIENT_*, G2-18)', () => {
    const startedWith = async () => (await allClients())[0]?.ceilings.toProps()

    it('is no ceiling at all on a box with no defaults, so a self-hosted box provisions as it always did', async () => {
      await provision()

      expect(await startedWith()).toEqual({
        maxEvents: null,
        maxTotalBytes: null,
        maxEventQuotaBytes: null,
        maxRetentionDays: null,
        clipsAllowed: true,
        liveAllowed: true,
        maxLiveDays: null,
        maxEventsPerPeriod: null,
        periodStartedAt: null,
      })
    })

    it('gives a client with no ceilings named every default the box has', async () => {
      await provision({}, { defaults: A_TIER })

      expect(await startedWith()).toMatchObject({ ...A_TIER, liveAllowed: true })
    })

    it('starts the period on the day it is provisioned when the box sets a count per period', async () => {
      await provision({}, { defaults: A_TIER })

      expect((await startedWith())?.periodStartedAt).toEqual(AT)
    })

    it('leaves the period undated on a box with no count per period', async () => {
      await provision({}, { defaults: { ...A_TIER, maxEventsPerPeriod: null } })

      expect((await startedWith())?.periodStartedAt).toBeNull()
    })

    it('keeps the ceilings the operator names, and takes the default for those it leaves out', async () => {
      await provision({ ceilings: { maxEvents: 5, maxLiveDays: 7 } }, { defaults: A_TIER })

      expect(await startedWith()).toMatchObject({ ...A_TIER, maxEvents: 5, maxLiveDays: 7 })
    })

    it('lets the operator lift a default for one client with an explicit null', async () => {
      await provision({ ceilings: { maxTotalBytes: null } }, { defaults: A_TIER })

      expect(await startedWith()).toMatchObject({ ...A_TIER, maxTotalBytes: null })
    })

    it('is refused, creating nothing, when a ceiling the operator names is one the domain refuses', async () => {
      const result = await provision({ ceilings: { maxLiveDays: 400 } }, { defaults: A_TIER })

      expect(!result.ok && result.error.code).toBe('clientCeilings.maxLiveDaysInvalid')
      expect(await allClients()).toEqual([])
      expect(audit.all()).toEqual([])
      expect(mailer.sent).toHaveLength(0)
    })
  })

  describe('the entry it writes (client.created)', () => {
    it('says which ceilings the client started with, from the defaults and from the operator alike', async () => {
      const result = await provision({ ceilings: { maxEvents: 5 } }, { defaults: A_TIER })

      const [entry, ...others] = audit.all()
      expect(others).toEqual([])
      expect(entry).toMatchObject({
        action: 'client.created',
        subject: { type: 'client', id: result.ok ? result.value.clientId : null },
        clientId: result.ok ? result.value.clientId : null,
        details: {
          ceilings: {
            maxEvents: 5,
            maxEventsPerPeriod: 6,
            maxTotalBytes: 20_000_000_000,
            maxEventQuotaBytes: 5_000_000_000,
            maxRetentionDays: 30,
            maxLiveDays: 3,
            clipsAllowed: true,
            liveAllowed: true,
            periodStartedAt: AT.toISOString(),
          },
        },
      })
    })

    it('is written for a client with no ceiling too, which is the fact that it was never limited', async () => {
      await provision()

      expect(audit.all().map((row) => row.action)).toEqual(['client.created'])
    })

    it('is the operator act, by id, when an operator provisions', async () => {
      await provision()

      expect(audit.all()[0]?.actor).toEqual({
        kind: 'operator',
        userId: asUserId(OPERATOR),
        label: null,
      })
      expect(audit.all()[0]?.at).toEqual(AT)
    })

    it('is the system act, under a label, when nobody provisions', async () => {
      await provision({ createdBy: null })

      expect(audit.all()[0]?.actor).toEqual({
        kind: 'system',
        userId: null,
        label: 'provision-client-owner',
      })
    })

    it('carries no name and no address: the log is read by people who may read neither', async () => {
      await provision({}, { defaults: A_TIER })

      const text = JSON.stringify(audit.all())
      expect(text).not.toContain(OWNER)
      expect(text).not.toContain('Camille')
    })

    it('is written before the invitation is, so no mail goes for a client the log cannot name', async () => {
      let entriesWhenInvited = -1
      const issue: IssueInvitation = async (input) => {
        entriesWhenInvited = audit.all().length
        return issueWith(mailer)(input)
      }

      await provision({}, { issue })

      expect(entriesWhenInvited).toBe(1)
    })

    it('removes the client and sends nothing when the log cannot be written', async () => {
      const failing: AuditRecorder = {
        record: async () => {
          throw new Error('database is locked')
        },
      }

      await expect(provision({}, { audit: failing })).rejects.toThrow('database is locked')

      expect(await allClients()).toEqual([])
      expect(mailer.sent).toHaveLength(0)
      expect(tokens.all).toHaveLength(0)
    })

    it('removes the client and sends nothing when the log refuses the entry', async () => {
      // An id outside the log's alphabet: the entry that names the client is refused.
      const unnameable = Object.assign(Object.create(ids) as SequentialIdGenerator, {
        clientId: () => asClientId('not a valid id!'),
      })

      const result = await provision({}, { ids: unnameable })

      expect(!result.ok && result.error.code).toBe('audit.subjectIdInvalid')
      expect(await allClients()).toEqual([])
      expect(mailer.sent).toHaveLength(0)
    })

    it('stays in the log when the invitation then fails, a line for an intent that failed', async () => {
      const broken: IssueInvitation = async () => {
        throw new Error('disk full')
      }

      await expect(provision({}, { issue: broken })).rejects.toThrow('disk full')

      expect(await allClients()).toEqual([])
      expect(audit.all().map((row) => row.action)).toEqual(['client.created'])
    })
  })

  describe('the invitation it sends', () => {
    it('is a client-owner invitation to that client, written by whoever provisioned', async () => {
      const result = await provision()

      expect(tokens.all[0]).toMatchObject({
        purpose: 'invitation',
        clientId: result.ok ? result.value.clientId : null,
        clientRole: 'owner',
        eventId: null,
        userId: null,
        createdBy: OPERATOR,
      })
    })

    it('may come from the system, which has no account', async () => {
      await provision({ createdBy: null })

      expect(tokens.all[0]?.createdBy).toBeNull()
    })

    it('goes by mail, in the client language, naming the client and asking the owner to manage it', async () => {
      const result = await provision({ locale: 'en' })

      expect(mailer.sent).toHaveLength(1)
      expect(mailer.sent[0]?.to).toBe(OWNER)
      expect(mailer.sent[0]?.text).toContain('manage the EventSlide space "Camille et Sacha"')
      expect(result.ok && result.value.invitation.delivery).toBe('mail')
      expect(result.ok && 'link' in result.value.invitation).toBe(false)
    })

    it('comes back as a link to pass on when the box has no mail relay', async () => {
      const result = await provision({}, { mailer: nullMailer })

      expect(result.ok && result.value.invitation.delivery).toBe('link')
      expect(
        result.ok && 'link' in result.value.invitation && result.value.invitation.link,
      ).toContain('/invite/secret-1')
    })

    it('is the same for an address that already has an account', async () => {
      await users.save(aUser({ id: 'user-known', email: OWNER }))

      const result = await provision()

      expect(result.ok && result.value.invitation.delivery).toBe('mail')
      expect(tokens.all).toHaveLength(1)
      expect(await users.findById(asUserId('user-known'))).not.toBeNull()
    })
  })

  describe('when it cannot go through', () => {
    it('creates no client for an address that is not one, and sends nothing', async () => {
      const result = await provision({ ownerEmail: 'not an address' })

      expect(result.ok).toBe(false)
      expect(await allClients()).toEqual([])
      expect(mailer.sent).toHaveLength(0)
    })

    it('invites nobody to a client whose name is refused', async () => {
      const result = await provision({ clientName: '   ' })

      expect(result.ok).toBe(false)
      expect(mailer.sent).toHaveLength(0)
      expect(tokens.all).toHaveLength(0)
    })

    it('removes the client it just made when the address is over its hourly cap', async () => {
      for (let attempt = 0; attempt < INVITATION_MAX_PER_ADDRESS_PER_HOUR; attempt += 1) {
        await tokens.save(
          anAccountToken({
            id: `earlier-${attempt}`,
            purpose: 'invitation',
            email: OWNER,
            userId: null,
            clientId: 'client-9',
            clientRole: 'owner',
            delivery: 'mail',
          }),
        )
      }

      const result = await provision()

      expect(!result.ok && result.error.code).toBe('invitation.tooManyForAddress')
      expect(await allClients()).toEqual([])
    })

    it('removes the client and rethrows when the invitation could not be written at all', async () => {
      const broken: IssueInvitation = async () => {
        throw new Error('disk full')
      }

      await expect(provision({}, { issue: broken })).rejects.toThrow('disk full')

      expect(await allClients()).toEqual([])
    })

    it('reports the failure that mattered when removing the client fails too', async () => {
      const broken: IssueInvitation = async () => {
        throw new Error('disk full')
      }
      const failingRemoval = Object.assign(Object.create(clients) as FakeClientRepository, {
        deleteIfEmpty: async () => {
          throw new Error('locked')
        },
      })

      await expect(provision({}, { issue: broken, clientsPort: failingRemoval })).rejects.toThrow(
        'disk full',
      )
    })
  })
})

const emailOf = (raw: string): EmailAddress => {
  const parsed = EmailAddress.create(raw)
  if (!parsed.ok) throw new Error('invalid fixture')
  return parsed.value
}
