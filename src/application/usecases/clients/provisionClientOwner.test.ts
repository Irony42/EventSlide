import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asUserId } from '../../../domain/shared/ids'
import { err } from '../../../domain/shared/result'
import { INVITATION_MAX_PER_ADDRESS_PER_HOUR } from '../../../domain/users/accountToken'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { Logger } from '../../ports/logger'
import { mailFailure, type Mailer } from '../../ports/mailer'
import { AT, aUser, anAccountToken } from '../../testing/builders'
import { FakeAccountTokenRepository } from '../../testing/fakeAccountTokenRepository'
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

const nullMailer: Mailer = {
  canDeliver: false,
  send: async () => err(mailFailure('notConfigured')),
}

describe('provisionClientOwner', () => {
  let clients: FakeClientRepository
  let tokens: FakeAccountTokenRepository
  let users: FakeUserRepository
  let mailer: FakeMailer
  let ids: SequentialIdGenerator
  let issueWith: (mailerToUse: Mailer) => IssueInvitation

  const provision = (
    overrides: Partial<ProvisionClientOwnerInput> = {},
    deps: { mailer?: Mailer; issue?: IssueInvitation; clientsPort?: FakeClientRepository } = {},
  ) =>
    makeProvisionClientOwner({
      createClient: makeCreateClient({ clients, ids, clock: new FakeClock(AT) }),
      issueInvitation: deps.issue ?? issueWith(deps.mailer ?? mailer),
      clients: deps.clientsPort ?? clients,
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
    ids = new SequentialIdGenerator()
    const secrets = new FakeSecretTokens()
    issueWith = (mailerToUse) =>
      makeIssueInvitation({
        tokens,
        secrets,
        mailer: mailerToUse,
        ids,
        clock: new FakeClock(AT),
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
