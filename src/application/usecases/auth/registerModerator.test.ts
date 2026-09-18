import { beforeEach, describe, expect, it } from 'vitest'
import type { EventRole } from '../../../domain/events/eventRole'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'
import type { PasswordHasher } from '../../ports/passwordHasher'
import { AT, anEvent, aUser } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeRegisterModerator, type RegisterModeratorInput } from './registerModerator'

/** What the host types into the invitation form and reads out to the invitee. */
const TEMPORARY = 'mot-de-passe-provisoire'

const hashOf = (plaintext: string): PasswordHash => `hash:${plaintext}`

const defaultProduces = (password: Password): PasswordHash => hashOf(password.value)

/**
 * A hasher whose output a test can dictate.
 *
 * `src/application/testing/` has no password hasher fake yet — it is written by work in
 * flight — and the empty-hash guard on `User.create` is only reachable by choosing what
 * `hash` returns, so this double is local to the file that needs it.
 */
class ScriptedPasswordHasher implements PasswordHasher {
  readonly dummyHash: PasswordHash = hashOf('mot-de-passe-factice')

  constructor(private readonly produces: (password: Password) => PasswordHash = defaultProduces) {}

  async hash(password: Password): Promise<PasswordHash> {
    return this.produces(password)
  }

  async verify(attempt: string, hash: PasswordHash): Promise<boolean> {
    return hash === hashOf(attempt)
  }

  needsRehash(): boolean {
    return false
  }
}

describe('registerModerator', () => {
  let events: FakeEventRepository
  let users: FakeUserRepository
  let memberships: FakeMembershipRepository
  let hasher: ScriptedPasswordHasher
  let ids: SequentialIdGenerator
  let clock: FakeClock

  const invite = (overrides: Partial<RegisterModeratorInput> = {}) =>
    makeRegisterModerator({ events, users, memberships, hasher, ids, clock })({
      eventId: asEventId('event-1'),
      actorId: asUserId('owner-1'),
      email: 'lea@example.test',
      displayName: null,
      temporaryPassword: TEMPORARY,
      ...overrides,
    })

  const storedInvitee = async () => {
    const email = EmailAddress.create('lea@example.test')
    return email.ok ? await users.findByEmail(email.value) : null
  }

  beforeEach(() => {
    users = new FakeUserRepository()
    memberships = new FakeMembershipRepository({ users })
    events = new FakeEventRepository({ memberships })
    hasher = new ScriptedPasswordHasher()
    ids = new SequentialIdGenerator()
    clock = new FakeClock()

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

  it('creates the account and grants it the moderator role for that event alone', async () => {
    const result = await invite()

    expect(result.ok && result.value).toEqual({ userId: asUserId('user-1'), created: true })
    expect(await memberships.listForUser(asUserId('user-1'))).toEqual([
      {
        eventId: asEventId('event-1'),
        userId: asUserId('user-1'),
        role: 'moderator',
        grantedAt: AT,
      },
    ])
  })

  /**
   * The escalation that turned a bounded window into permanent access: a disabled owner
   * reached this use case, `User.create` wrote `disabledAt: null`, and the host read the
   * temporary password out to themselves. One account switched off, another one on, with
   * a password the disabled owner knows.
   *
   * What stops it is the actor's own role read, not a rule written here: `roleFor`
   * answers `null` for a disabled account, so this is the ordinary "no part in this
   * event" path and gets the same 404 a stranger gets.
   */
  it('refuses an owner whose account has been disabled, so a switched-off host cannot mint an enabled one', async () => {
    const owner = aUser({ id: 'owner-1', email: 'camille@example.test', displayName: 'Camille' })
    await users.save(owner.disable(AT))

    const result = await invite()

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  /**
   * The mirror image, and the one that bites quietly. `roleFor` refuses a disabled
   * account, so asking it here would have made a disabled **co-owner** look like a
   * stranger: the invitation would have re-granted them as a moderator, and re-enabling
   * the account later would have given back the wrong role, permanently. This is why the
   * "already a member" question asks for the row rather than for the authority.
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
    ).toMatchObject({ role: 'owner' })
  })

  it('creates no account at all for a disabled owner, so nothing is left to sign in with', async () => {
    const owner = aUser({ id: 'owner-1', email: 'camille@example.test', displayName: 'Camille' })
    await users.save(owner.disable(AT))

    await invite()

    expect(await storedInvitee()).toBeNull()
  })

  it('forces the invitee to replace the password their host chose for them', async () => {
    await invite()

    const invitee = await storedInvitee()
    expect(invitee?.mustChangePassword).toBe(true)
    expect(invitee?.passwordHash).toBe(hashOf(TEMPORARY))
  })

  it('creates an account with no authority over the box, whoever did the inviting', async () => {
    // The host doing the inviting may be the box's operator — on a one-operator
    // instance they usually are. An invitation that carried a site role across would
    // hand the whole box to someone lent a laptop for one evening (docs/ROADMAP.md
    // §10.1). Asserted through `siteRoleFor`, which is the read authorization makes.
    users.seed(aUser({ id: 'operator-1', email: 'ops@example.test', siteRole: 'operator' }))
    memberships.seed({
      eventId: asEventId('event-1'),
      userId: asUserId('operator-1'),
      role: 'owner',
      grantedAt: AT,
    })

    await invite({ actorId: asUserId('operator-1') })

    expect(await users.siteRoleFor(asUserId('user-1'))).toBe('none')
  })

  it('leaves an existing operator account its own site role, which this never touches', async () => {
    // The other direction of the same rule: inviting someone who happens to operate the
    // box makes them a moderator of one event and changes nothing else about them.
    users.seed(aUser({ id: 'user-9', email: 'lea@example.test', siteRole: 'operator' }))

    await invite()

    expect(await users.siteRoleFor(asUserId('user-9'))).toBe('operator')
  })

  it('leaves an existing account its own password when granting it the role', async () => {
    users.seed(
      aUser({ id: 'user-9', email: 'lea@example.test', passwordHash: hashOf('son-mot-de-passe') }),
    )

    const result = await invite()

    expect(result.ok && result.value).toEqual({ userId: asUserId('user-9'), created: false })
    const invitee = await storedInvitee()
    expect(invitee?.passwordHash).toBe(hashOf('son-mot-de-passe'))
    expect(invitee?.mustChangePassword).toBe(false)
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
    expect(await memberships.listForEvent(asEventId('event-1'))).toHaveLength(2)
  })

  it('answers an owner of another event as if this one did not exist', async () => {
    const result = await invite({ eventId: asEventId('event-2') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect(!result.ok && result.error.kind).toBe('notFound')
    expect(await memberships.listForEvent(asEventId('event-2'))).toEqual([])
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
    expect(await memberships.roleFor(asEventId('event-1'), asUserId('user-9'))).toBe('moderator')
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
  })

  it('refuses an address that is not an address', async () => {
    const result = await invite({ email: 'lea' })

    expect(!result.ok && result.error.code).toBe('email.malformed')
  })

  it('refuses a temporary password below the password policy', async () => {
    const result = await invite({ temporaryPassword: 'court' })

    expect(!result.ok && result.error.code).toBe('password.tooShort')
  })

  it('refuses a temporary password that is only the invitee name', async () => {
    const result = await invite({
      displayName: 'Léa Durand-Martin',
      temporaryPassword: 'Léa Durand-Martin',
    })

    expect(!result.ok && result.error.code).toBe('password.sameAsName')
  })

  it('grants nothing when the hasher hands back an empty hash', async () => {
    hasher = new ScriptedPasswordHasher(() => '')

    const result = await invite()

    expect(!result.ok && result.error.code).toBe('user.passwordHashEmpty')
    expect(await storedInvitee()).toBeNull()
    expect(await memberships.listForEvent(asEventId('event-1'))).toHaveLength(1)
  })
})
