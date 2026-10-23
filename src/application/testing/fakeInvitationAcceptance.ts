import { invitationTargetOf, isAccountTokenUsable } from '../../domain/users/accountToken'
import type {
  AcceptInvitationRecord,
  InvitationAcceptance,
  InvitationAcceptanceOutcome,
} from '../ports/invitationAcceptance'
import type { ClientRepository } from '../ports/clientRepository'
import type { MembershipRepository, UserRepository } from '../ports/userRepository'
import type { FakeAccountTokenRepository } from './fakeAccountTokenRepository'
import type { FakeAuditLog } from './fakeAuditLog'

/**
 * In-memory `InvitationAcceptance`, composed of the fakes whose tables the real one writes in
 * one transaction.
 *
 * What it has to reproduce is the adapter's promises: **nothing is written unless the whole
 * of it is**, **calls do not interleave**, and **what is granted is read from the link and
 * not from the caller**. The first is kept by deciding everything that can refuse (is the
 * link usable and an invitation, is the address the link's, is it taken, is the id new)
 * before the first write. The second is kept by running calls one after another, which is
 * what a write transaction on one connection does: without it, two acceptances of one link
 * would each pass the check at their first `await` and both write.
 */
export interface FakeInvitationAcceptanceParts {
  readonly tokens: FakeAccountTokenRepository
  readonly users: UserRepository
  readonly memberships: MembershipRepository
  readonly clients: ClientRepository
  /** Where an entry rides the acceptance (G2-20): the log the world reads it back from. */
  readonly audit: FakeAuditLog
}

export class FakeInvitationAcceptance implements InvitationAcceptance {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly parts: FakeInvitationAcceptanceParts) {}

  accept(record: AcceptInvitationRecord): Promise<InvitationAcceptanceOutcome> {
    const run = this.queue.then(() => this.acceptNow(record))
    // A failure of one call must not poison the next: the queue only orders.
    this.queue = run.catch(() => undefined)
    return run
  }

  private async acceptNow(record: AcceptInvitationRecord): Promise<InvitationAcceptanceOutcome> {
    const { tokens, users, memberships, clients, audit } = this.parts
    const { account, now } = record

    const token = tokens.all.find((candidate) => candidate.id === record.tokenId)
    if (token === undefined || token.purpose !== 'invitation') return 'spent'
    if (!isAccountTokenUsable(token, now)) return 'spent'
    const grant = invitationTargetOf(token)
    if (grant === null) throw new Error('the invitation names nothing to grant')

    const userId = account.kind === 'new' ? account.user.id : account.userId
    const existing = await users.findById(userId)
    if (account.kind === 'existing' && existing === null) {
      throw new Error('the account that accepts does not exist')
    }
    const address = account.kind === 'new' ? account.user.email : existing?.email
    if (address === undefined || !address.equals(token.email)) {
      throw new Error('the invitation was written to another address')
    }

    if (account.kind === 'new') {
      if ((await users.findByEmail(address)) !== null) return 'emailTaken'
      // An id that exists is an error, never an overwrite: the adapter's plain `INSERT`.
      if (existing !== null) throw new Error('UNIQUE constraint failed: users.id')
    }

    // The foreign key on `actor_user_id`, decided before the first write like every other
    // refusal: in the adapter an entry the log refuses undoes the acceptance with it, and here
    // nothing is written yet to undo. The accepting account exists by the time the row goes in.
    const actorId = record.audit?.toProps().actor.userId ?? null
    if (actorId !== null && actorId !== userId && (await users.findById(actorId)) === null) {
      throw new Error('FOREIGN KEY constraint failed: the actor is not an account')
    }

    await tokens.consume(record.tokenId, now)

    if (account.kind === 'new') {
      await users.save(account.user)
    } else if (account.emailVerifiedAt !== null && existing !== null) {
      await users.save(existing.verifyEmail(account.emailVerifiedAt))
    }

    if (grant.kind === 'event') {
      // `ON CONFLICT DO NOTHING`: a role already held in this event is left as it is.
      if ((await memberships.membershipFor(grant.eventId, userId)) === null) {
        await memberships.grant({
          eventId: grant.eventId,
          userId,
          role: grant.role,
          grantedAt: now,
        })
      }
    } else {
      // A client: absent, it is granted; a member invited as owner is raised, and the original
      // instant is kept as the adapter keeps it; an owner is never lowered.
      const held = (await clients.membershipsForUser(userId)).find(
        (membership) => membership.clientId === grant.clientId,
      )
      if (held === undefined) {
        await clients.grantMember({
          clientId: grant.clientId,
          userId,
          role: grant.role,
          grantedAt: now,
        })
      } else if (grant.role === 'owner' && held.role !== 'owner') {
        await clients.grantMember({ ...held, role: 'owner' })
      }
    }

    // Last, as in the adapter: the entry describes what was just written.
    if (record.audit !== undefined) {
      audit.withAccounts(userId)
      if (actorId !== null) audit.withAccounts(actorId)
      await audit.record(record.audit)
    }
    return 'accepted'
  }
}
