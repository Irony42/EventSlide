import { beforeEach, describe, expect, it } from 'vitest'
import { err } from '../../../domain/shared/result'
import { asAccountTokenId, asClientId, asUserId } from '../../../domain/shared/ids'
import { mailFailure } from '../../ports/mailer'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import type { FakeMailer } from '../../testing/fakeMailer'
import {
  CLIENT_ID,
  MEMBER_ID,
  NEWCOMER,
  NEW_CLIENT_ID,
  OPERATOR_ID,
  OWNER_ID,
  PUBLIC_URL,
  makeOperatorGuardWorld,
  silentLogger,
  type OperatorGuardWorld,
} from '../../testing/operatorGuardWorld'
import { makeIssueInvitation } from '../auth/issueInvitation'
import {
  makeInviteToClientAsOperator,
  type InviteToClientAsOperatorInput,
} from './inviteToClientAsOperator'

/** A box with no mail relay: the production `NullMailer`'s answer, written out. */
const noRelay = { canDeliver: false, send: async () => err(mailFailure('notConfigured')) }

describe('inviteToClientAsOperator', () => {
  let world: OperatorGuardWorld

  const invite = (overrides: Partial<InviteToClientAsOperatorInput> = {}) =>
    world.useCases.inviteToClientAsOperator({
      actorId: asUserId(OPERATOR_ID),
      clientId: asClientId(CLIENT_ID),
      email: NEWCOMER,
      role: 'owner',
      locale: 'fr',
      ...overrides,
    })

  beforeEach(() => {
    world = makeOperatorGuardWorld()
  })

  describe('a client that has an event (R1)', () => {
    it('writes the invitation as waiting for an owner, and says so', async () => {
      const result = await invite()

      expect(result.ok && result.value.pendingApproval).toBe(true)
      expect(world.tokens.all).toHaveLength(1)
      expect(world.tokens.all[0]).toMatchObject({
        purpose: 'invitation',
        clientId: CLIENT_ID,
        clientRole: 'owner',
        requiresApproval: true,
        approvedAt: null,
        createdBy: OPERATOR_ID,
      })
    })

    // That an archived or a closed event counts is the adapter's to hold, in
    // `sqliteClientRepository.test.ts`: this fake links events and has no status to ignore.

    it('waits for an owner too in a client that has a member and no event yet, where the customer has just signed up', async () => {
      world = makeOperatorGuardWorld({ clientHasEvents: false })
      await world.seatTheClient()

      const result = await invite({ email: 'membre@example.test', role: 'owner' })

      expect(result.ok && result.value.pendingApproval).toBe(true)
      expect(world.tokens.all[0]?.requiresApproval).toBe(true)
    })

    it('does the same for a member invitation as for an owner one', async () => {
      const result = await invite({ role: 'member' })

      expect(result.ok && result.value.pendingApproval).toBe(true)
      expect(world.tokens.all[0]?.requiresApproval).toBe(true)
    })
  })

  describe('a client with no event (R1)', () => {
    it('writes an invitation that needs nobody’s approval, the one case the operator handles alone', async () => {
      const result = await invite({ clientId: asClientId(NEW_CLIENT_ID) })

      expect(result.ok && result.value.pendingApproval).toBe(false)
      expect(world.tokens.all[0]).toMatchObject({
        requiresApproval: false,
        clientId: NEW_CLIENT_ID,
      })
    })
  })

  describe('delivery, which is issueInvitation’s and unchanged', () => {
    it('mails the link and shows the operator nothing when the box can mail', async () => {
      const result = await invite({ clientId: asClientId(NEW_CLIENT_ID) })

      expect(result.ok && result.value.delivery).toBe('mail')
      expect(result.ok && 'link' in result.value).toBe(false)
      expect((world.mailer as FakeMailer).sent).toHaveLength(1)
    })

    it('shows the operator the link on a box with no relay, and it still opens nothing until approved', async () => {
      world = makeOperatorGuardWorld({ mailer: noRelay })

      const result = await invite()

      expect(result.ok && result.value).toMatchObject({ delivery: 'link', pendingApproval: true })
      const link = result.ok && result.value.delivery === 'link' ? result.value.link : ''
      const token = link.split('/').pop() ?? ''
      expect(token).not.toBe('')
      expect(await world.useCases.previewInvitation({ token })).toMatchObject({ ok: false })
    })
  })

  describe('who may', () => {
    it('refuses an account that does not operate the box, and writes nothing', async () => {
      const result = await invite({ actorId: asUserId(OWNER_ID) })

      expect(!result.ok && result.error.kind).toBe('forbidden')
      expect(world.tokens.all).toHaveLength(0)
      expect(await world.logged()).toHaveLength(0)
    })

    it('refuses a member of the client, whatever the client says about them', async () => {
      await world.seatTheClient()

      const result = await invite({ actorId: asUserId(MEMBER_ID) })

      expect(!result.ok && result.error.code).toBe('auth.forbidden')
    })

    it('refuses a client that does not exist', async () => {
      const result = await invite({ clientId: asClientId('ghost') })

      expect(!result.ok && result.error.code).toBe('client.notFound')
      expect(world.tokens.all).toHaveLength(0)
    })

    it('refuses an address that is not one, before anything is written', async () => {
      const result = await invite({ email: 'not an address' })

      expect(result.ok).toBe(false)
      expect(world.tokens.all).toHaveLength(0)
      expect(await world.logged()).toHaveLength(0)
    })

    it('passes on what issueInvitation refuses, and writes no line for it', async () => {
      for (let count = 0; count < 5; count += 1) await invite()

      const sixth = await invite()

      expect(!sixth.ok && sixth.error.code).toBe('invitation.tooManyForAddress')
      expect(await world.logged()).toHaveLength(5)
    })
  })

  describe('the audit line (R5)', () => {
    it('records that the operator invited, and whether it waits, naming the invitation and the client', async () => {
      const result = await invite()

      const [line] = await world.logged()
      expect(line).toMatchObject({
        action: 'invitation.issued',
        actor: { kind: 'operator', userId: OPERATOR_ID },
        subject: { type: 'invitation', id: result.ok ? result.value.invitationId : '' },
        clientId: CLIENT_ID,
        details: { pendingApproval: true },
      })
    })

    it('says pendingApproval false for an invitation that waits for nobody', async () => {
      await invite({ clientId: asClientId(NEW_CLIENT_ID) })

      expect((await world.logged())[0]?.details).toEqual({ pendingApproval: false })
    })

    it('holds neither the address nor the link nor the role: the vocabulary has no word for them', async () => {
      await invite()

      const written = JSON.stringify(await world.logged())
      expect(written).not.toContain('example.test')
      expect(written).not.toContain('secret-')
      expect(written).not.toContain('"owner"')
    })

    it('revokes the invitation again when the log refuses the line, so no operator action goes unrecorded', async () => {
      // A log that knows no account refuses the operator as an actor.
      const refusing = makeInviteToClientAsOperator({
        users: world.users,
        clients: world.clients,
        tokens: world.tokens,
        issueInvitation: world.useCases.issueInvitation,
        audit: new FakeAuditLog(),
        clock: world.clock,
      })

      await expect(
        refusing({
          actorId: asUserId(OPERATOR_ID),
          clientId: asClientId(CLIENT_ID),
          email: NEWCOMER,
          role: 'owner',
          locale: 'fr',
        }),
      ).rejects.toThrow(/FOREIGN KEY/)

      expect(world.tokens.all).toHaveLength(1)
      expect(world.tokens.all[0]?.revokedAt).not.toBeNull()
    })

    it('revokes it too when the entry cannot even be built, and says why', async () => {
      // An id the log's own rules refuse: a space is not in the alphabet of an id.
      const oddIds = { accountTokenId: () => asAccountTokenId('not an id') }
      const odd = makeInviteToClientAsOperator({
        users: world.users,
        clients: world.clients,
        tokens: world.tokens,
        issueInvitation: makeIssueInvitation({
          tokens: world.tokens,
          secrets: world.secrets,
          mailer: world.mailer,
          ids: oddIds,
          clock: world.clock,
          logger: silentLogger,
          publicUrl: PUBLIC_URL,
        }),
        audit: world.audit,
        clock: world.clock,
      })

      const result = await odd({
        actorId: asUserId(OPERATOR_ID),
        clientId: asClientId(CLIENT_ID),
        email: NEWCOMER,
        role: 'owner',
        locale: 'fr',
      })

      expect(!result.ok && result.error.code).toBe('audit.subjectIdInvalid')
      expect(world.tokens.all[0]?.revokedAt).not.toBeNull()
      expect(await world.logged()).toHaveLength(0)
    })
  })
})
