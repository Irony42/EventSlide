import { canInviteModerators } from '../../../domain/events/eventRole'
import { isMutable } from '../../../domain/events/eventStatus'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { Password, type PasswordContext } from '../../../domain/users/password'
import { User } from '../../../domain/users/user'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { PasswordHasher } from '../../ports/passwordHasher'
import type { MembershipRepository, UserRepository } from '../../ports/userRepository'

export interface RegisterModeratorInput {
  readonly eventId: EventId
  /** The signed-in host doing the inviting. Their role is checked on this event only. */
  readonly actorId: UserId
  readonly email: string
  readonly displayName: string | null
  /**
   * Used only when the address has no account yet. The host reads it out to the person
   * they are handing the laptop to, and `mustChangePassword` makes it single-use.
   */
  readonly temporaryPassword: string
}

export interface RegisterModeratorResult {
  readonly userId: UserId
  /** Tells the caller whether the temporary password is worth showing the host. */
  readonly created: boolean
}

export interface RegisterModeratorDeps {
  readonly events: EventRepository
  readonly users: UserRepository
  readonly memberships: MembershipRepository
  readonly hasher: PasswordHasher
  readonly ids: IdGenerator
  readonly clock: Clock
}

export type RegisterModerator = (
  input: RegisterModeratorInput,
) => Promise<Result<RegisterModeratorResult, DomainError>>

/** `exactOptionalPropertyTypes` forbids handing the context an explicit `undefined`. */
const passwordContext = (email: EmailAddress, displayName: string | null): PasswordContext =>
  displayName === null ? { email: email.value } : { email: email.value, displayName }

/**
 * An owner invites one person to moderate one event.
 *
 * The role is granted for the event in the input and nowhere else: 1.0 had a single
 * shared admin password, so lending the moderation screen for one wedding handed over
 * every other event on the box.
 */
export const makeRegisterModerator =
  ({ events, users, memberships, hasher, ids, clock }: RegisterModeratorDeps): RegisterModerator =>
  async ({ eventId, actorId, email, displayName, temporaryPassword }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    // Scoped read: an owner of the corporate gala is nobody on this wedding, and a
    // moderator is nobody's recruiter — a moderator who could invite moderators would
    // be an owner with extra steps.
    const actorRole = await memberships.roleFor(eventId, actorId)
    if (actorRole === null || !canInviteModerators(actorRole)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    // An archived event is a record, not a live object: it allows no moderation, so a
    // console handed out for it would have nothing to act on.
    if (!isMutable(event.status)) {
      return err(DomainError.conflict('event.immutable', { status: event.status }))
    }

    // Parsed after authorization, never before: an unauthorized caller learns nothing,
    // not even whether their input was well-formed. The reason reaches the host though —
    // this is their own invitation form, not a login.
    const parsedEmail = EmailAddress.create(email)
    if (!parsedEmail.ok) return parsedEmail

    const existing = await users.findByEmail(parsedEmail.value)
    const now = clock.now()

    if (existing !== null) {
      const role = await memberships.roleFor(eventId, existing.id)
      // Re-inviting would otherwise silently downgrade a co-owner to moderator.
      if (role !== null) return err(DomainError.conflict('membership.alreadyExists', { role }))

      // The existing account keeps its own password. An invitation that reset it would
      // let one host take over a colleague's account, and with it every other event
      // that colleague runs.
      await memberships.grant({ eventId, userId: existing.id, role: 'moderator', grantedAt: now })
      return ok({ userId: existing.id, created: false })
    }

    const password = Password.create(
      temporaryPassword,
      passwordContext(parsedEmail.value, displayName),
    )
    if (!password.ok) return password

    const created = User.create(
      {
        email: parsedEmail.value,
        displayName,
        passwordHash: await hasher.hash(password.value),
        // Someone else chose this password and said it out loud. The invitee replaces
        // it before they can do anything with the account.
        mustChangePassword: true,
      },
      ids.userId(),
      now,
    )
    if (!created.ok) return created

    await users.save(created.value)
    await memberships.grant({
      eventId,
      userId: created.value.id,
      role: 'moderator',
      grantedAt: now,
    })
    return ok({ userId: created.value.id, created: true })
  }
