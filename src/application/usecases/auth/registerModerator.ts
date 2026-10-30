import type { ClientLocale } from '../../../domain/clients/clientLocale'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, type Result } from '../../../domain/shared/result'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository, UserRepository } from '../../ports/userRepository'
import type { IssueInvitation, IssuedInvitation } from './issueInvitation'
import { requireEditable, requireEventRole, requireWritable } from '../shared/eventRole'

export interface RegisterModeratorInput {
  readonly eventId: EventId
  /** The signed-in host doing the inviting. Their role is checked on this event only. */
  readonly actorId: UserId
  readonly email: string
  /** The language of the host's page: the language the invitation is written in. */
  readonly locale: ClientLocale
}

export interface RegisterModeratorDeps {
  readonly events: EventRepository
  /** Only the lookup by address, for "is this person already a member of the event". */
  readonly users: Pick<UserRepository, 'findByEmail'>
  readonly memberships: MembershipRepository
  readonly issueInvitation: IssueInvitation
}

export type RegisterModerator = (
  input: RegisterModeratorInput,
) => Promise<Result<IssuedInvitation, DomainError>>

/**
 * An owner invites one person to moderate one event — **by a link they will accept**, not by
 * an account made for them (docs/ROADMAP.md §10.3; free plan G2-09, paid plan P3-10).
 *
 * What used to happen here, and why it stopped: the host typed a password, the box created
 * an account with it, and the host read it out loud. That made a third party choose the
 * credential of an account in someone else's name, attached an existing account to an event
 * without its owner's say, and answered "was an account created?" — which is whether the
 * address was already on the box. Now nothing is created and nothing is attached: an
 * invitation is written (`issueInvitation`), the invitee accepts it, and only then does an
 * account exist or a role appear. The answer is the same for an address that has an account
 * and one that has not.
 *
 * The role is offered for the event in the input and nowhere else: 1.0 had a single shared
 * admin password, so lending the moderation screen for one wedding handed over every other
 * event on the box.
 *
 * **Authority is read here, from storage, on this request**, and only an owner of this event
 * may invite: `canInviteModerators` is asked rather than the qualifying roles being listed,
 * so a role added later is refused by default. It is read **again** when the invitation is
 * accepted, a week later at the latest (`makeResolveInvitation`).
 */
export const makeRegisterModerator =
  ({ events, users, memberships, issueInvitation }: RegisterModeratorDeps): RegisterModerator =>
  async ({ eventId, actorId, email, locale }) => {
    const event = await events.findById(eventId)
    if (event === null || event.isTakenDown()) return err(DomainError.notFound('event.notFound'))

    // Scoped read: an owner of the corporate gala is nobody on this wedding.
    const allowed = await requireEventRole(memberships, eventId, actorId, 'inviteModerators')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    // An archived event is a record, not a live object: it allows no moderation, so a
    // link handed out for it would have nothing to act on.
    const editable = requireEditable(event)
    if (!editable.ok) return editable

    // Parsed after authorization, never before: an unauthorized caller learns nothing,
    // not even whether their input was well-formed. The reason reaches the host though —
    // this is their own invitation form, not a login.
    const address = EmailAddress.create(email)
    if (!address.ok) return address

    // The one thing asked about the address: is it already on this event's own list. The
    // owner can read that list, so it tells them nothing they cannot see, and it keeps a
    // co-owner from being "invited" back down to moderator. The **row**, not the authority:
    // `roleFor` refuses a disabled account, which would make a disabled co-owner look like a
    // stranger. Nothing about an address that is not a member of this event is revealed.
    const existing = await users.findByEmail(address.value)
    if (existing !== null) {
      const held = await memberships.membershipFor(eventId, existing.id)
      if (held !== null) {
        return err(DomainError.conflict('membership.alreadyExists', { role: held.role }))
      }
    }

    return issueInvitation({
      email: address.value.value,
      locale,
      place: { kind: 'event', eventId, role: 'moderator', name: event.name.value },
      createdBy: actorId,
    })
  }
