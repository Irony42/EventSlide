import { beforeEach, describe, expect, it } from 'vitest'
import type { EventRole } from '../../../domain/events/eventRole'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { Logger } from '../../ports/logger'
import { AT, anEvent, aUser } from '../../testing/builders'
import { FakeAccountTokenRepository } from '../../testing/fakeAccountTokenRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMailer } from '../../testing/fakeMailer'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeSecretTokens } from '../../testing/fakeSecretTokens'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeIssueInvitation, type IssueInvitation } from './issueInvitation'
import { makeRegisterModerator, type RegisterModeratorInput } from './registerModerator'

const quietLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quietLogger,
}

describe('registerModerator', () => {
  let events: FakeEventRepository
  let users: FakeUserRepository
  let memberships: FakeMembershipRepository
  let tokens: FakeAccountTokenRepository
  let mailer: FakeMailer

  let issue: IssueInvitation

  const invite = (overrides: Partial<RegisterModeratorInput> = {}) =>
    makeRegisterModerator({ events, users, memberships, issueInvitation: issue })({
      eventId: asEventId('event-1'),
      actorId: asUserId('owner-1'),
      email: 'lea@example.test',
      locale: 'fr',
      ...overrides,
    })

  const accountAt = async (address: string) => {
    const email = EmailAddress.create(address)
    return email.ok ? await users.findByEmail(email.value) : null
  }

  beforeEach(() => {
    users = new FakeUserRepository()
    memberships = new FakeMembershipRepository({ users })
    events = new FakeEventRepository({ memberships })
    mailer = new FakeMailer()
    tokens = new FakeAccountTokenRepository()
      .withAccounts(asUserId('owner-1'), asUserId('operator-1'), asUserId('mod-1'))
      .withEvents(asEventId('event-1'), asEventId('event-2'), asEventId('event-3'))
      .withClients(asClientId('client-1'))

    // One issuer for the test, as the box has one: its ids and secrets keep counting.
    issue = makeIssueInvitation({
      tokens,
      secrets: new FakeSecretTokens(),
      mailer,
      ids: new SequentialIdGenerator(),
      clock: new FakeClock(AT),
      logger: quietLogger,
      publicUrl: 'https://photos.example.test',
    })

    events.seed(
      anEvent({ id: 'event-1', ownerId: 'owner-1' }),
      anEvent({ id: 'event-2', ownerId: 'owner-1', slug: 'gala-annuel', joinCode: 'ZZZ999' }),
    )
    users.seed(aUser({ id: 'owner-1', email: 'camille@example.test', displayName: 'Camille' }))
    memberships.seed({
      eventId: asEventId('event-1'),
      userId: asUserId('owner-1'),
      role: 'owner',
      grantedAt: AT,
    })
  })

  // ------------------------------------------------------- what it now does --

  it('writes an invitation to that event, authored by the owner, and mails the address', async () => {
    const result = await invite()

    expect(result.ok && result.value.delivery).toBe('mail')
    expect(tokens.all).toHaveLength(1)
    expect(tokens.all[0]).toMatchObject({
      purpose: 'invitation',
      eventId: 'event-1',
      eventRole: 'moderator',
      createdBy: 'owner-1',
    })
    expect(mailer.sent[0]?.to).toBe('lea@example.test')
    expect(mailer.sent[0]?.text).toContain('/invite/')
  })

  it('creates no account and grants no role: nothing exists until the invitation is accepted', async () => {
    await invite()

    expect(await accountAt('lea@example.test')).toBeNull()
    expect(await memberships.listForEvent(asEventId('event-1'))).toHaveLength(1)
    expect(await memberships.listForUser(asUserId('owner-1'))).toHaveLength(1)
  })

  it('does not attach an existing account to the event: that account has to accept', async () => {
    users.seed(aUser({ id: 'user-9', email: 'lea@example.test' }))

    const result = await invite()

    expect(result.ok).toBe(true)
    expect(await memberships.membershipFor(asEventId('event-1'), asUserId('user-9'))).toBeNull()
  })

  it('answers an address that has an account exactly as one that has none', async () => {
    users.seed(aUser({ id: 'user-9', email: 'connue@example.test' }))

    const known = await invite({ email: 'connue@example.test' })
    const unknown = await invite({ email: 'inconnue@example.test' })

    expect(known.ok && unknown.ok).toBe(true)
    const shape = (result: typeof known) =>
      result.ok ? Object.keys(result.value).sort() : ['refused']
    expect(shape(known)).toEqual(shape(unknown))
    expect(known.ok && known.value.delivery).toBe(unknown.ok && unknown.value.delivery)
    expect(mailer.sent.map((sent) => sent.subject)[0]).toBe(
      mailer.sent.map((sent) => sent.subject)[1],
    )
  })

  it('leaves an existing operator account its own site role, which this never touches', async () => {
    users.seed(aUser({ id: 'user-9', email: 'lea@example.test', siteRole: 'operator' }))

    await invite()

    expect(await users.siteRoleFor(asUserId('user-9'))).toBe('operator')
  })

  it('writes the invitation in the language of the host page, and names the event', async () => {
    await invite({ locale: 'en' })

    expect(mailer.sent[0]?.text).toContain('Hello,')
    expect(mailer.sent[0]?.text).toContain('Camille & Sacha')
  })

  // ----------------------------------------------------------- who may invite --

  /**
   * The escalation that turned a bounded window into permanent access: a disabled owner
   * could mint an enabled account. What stops it is the actor's own role read, not a rule
   * written here: `roleFor` answers `null` for a disabled account, so this is the ordinary
   * "no part in this event" path and gets the same 404 a stranger gets.
   */
  it('refuses an owner whose account has been disabled', async () => {
    const owner = aUser({ id: 'owner-1', email: 'camille@example.test', displayName: 'Camille' })
    await users.save(owner.disable(AT))

    const result = await invite()

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect(tokens.all).toHaveLength(0)
    expect(mailer.sent).toHaveLength(0)
  })

  /**
   * The mirror image, and the one that bites quietly. `roleFor` refuses a disabled account,
   * so asking it here would have made a disabled **co-owner** look like a stranger. This is
   * why "already a member" asks for the row rather than for the authority.
   */
  it('refuses to re-invite a disabled co-owner rather than downgrading them to moderator', async () => {
    const colleague = aUser({ id: 'owner-2', email: 'lea@example.test' })
    await users.save(colleague.disable(AT))
    memberships.seed({
      eventId: asEventId('event-1'),
      userId: asUserId('owner-2'),
      role: 'owner',
      grantedAt: AT,
    })

    const result = await invite()

    expect(!result.ok && result.error.code).toBe('membership.alreadyExists')
    expect(
      await memberships.membershipFor(asEventId('event-1'), asUserId('owner-2')),
    ).toMatchObject({
      role: 'owner',
    })
    expect(tokens.all).toHaveLength(0)
  })

  it('refuses a moderator who tries to invite another moderator', async () => {
    memberships.seed({
      eventId: asEventId('event-1'),
      userId: asUserId('mod-1'),
      role: 'moderator',
      grantedAt: AT,
    })

    const result = await invite({ actorId: asUserId('mod-1') })

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
    expect(tokens.all).toHaveLength(0)
  })

  it('answers an owner of another event as if this one did not exist', async () => {
    const result = await invite({ eventId: asEventId('event-2') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect(!result.ok && result.error.kind).toBe('notFound')
    expect(tokens.all).toHaveLength(0)
  })

  it('tells a caller with no part in the event nothing about their own input', async () => {
    const result = await invite({ actorId: asUserId('etrangere-1'), email: 'lea' })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('does not count a role on another event as a role on this one', async () => {
    users.seed(aUser({ id: 'user-9', email: 'lea@example.test' }))
    memberships.seed({
      eventId: asEventId('event-2'),
      userId: asUserId('user-9'),
      role: 'moderator',
      grantedAt: AT,
    })

    const result = await invite()

    expect(result.ok).toBe(true)
  })

  it.each<EventRole>(['owner', 'moderator'])(
    'refuses an address that is already %s of the event',
    async (role) => {
      users.seed(aUser({ id: 'user-9', email: 'lea@example.test' }))
      memberships.seed({
        eventId: asEventId('event-1'),
        userId: asUserId('user-9'),
        role,
        grantedAt: AT,
      })

      const result = await invite()

      expect(!result.ok && result.error.code).toBe('membership.alreadyExists')
      expect(!result.ok && result.error.kind).toBe('conflict')
      expect(mailer.sent).toHaveLength(0)
    },
  )

  it('refuses an event that does not exist', async () => {
    const result = await invite({ eventId: asEventId('event-inconnu') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses an archived event, which allows no moderation to hand out', async () => {
    events.seed(
      anEvent({
        id: 'event-3',
        ownerId: 'owner-1',
        status: 'archived',
        slug: 'mariage-2019',
        joinCode: 'AAA111',
      }),
    )
    memberships.seed({
      eventId: asEventId('event-3'),
      userId: asUserId('owner-1'),
      role: 'owner',
      grantedAt: AT,
    })

    const result = await invite({ eventId: asEventId('event-3') })

    expect(!result.ok && result.error.code).toBe('event.immutable')
    expect(tokens.all).toHaveLength(0)
  })

  it('refuses an address that is not an address, to an owner who is entitled to the reason', async () => {
    const result = await invite({ email: 'lea' })

    expect(!result.ok && result.error.code).toBe('email.malformed')
    expect(tokens.all).toHaveLength(0)
  })
})
