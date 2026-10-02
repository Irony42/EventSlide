import { isAccountTokenUsable } from '../../domain/users/accountToken'
import type {
  AcceptInvitationRecord,
  InvitationAcceptance,
  InvitationAcceptanceOutcome,
} from '../ports/invitationAcceptance'
import type { ClientRepository } from '../ports/clientRepository'
import type { EventRepository } from '../ports/eventRepository'
import type { MembershipRepository, UserRepository } from '../ports/userRepository'
import type { FakeAccountTokenRepository } from './fakeAccountTokenRepository'

/**
 * In-memory `InvitationAcceptance`, composed of the fakes whose tables the real one writes in
 * one transaction.
 *
 * What it has to reproduce is the adapter's two promises: **nothing is written unless the
 * whole of it is**, and **calls do not interleave**. The first is kept by deciding everything
 * that can refuse (is the link usable, is the address taken) before the first write. The
 * second is kept by running calls one after another, which is what a write transaction on one
 * connection does: without it, two acceptances of one link would each pass the check at their
 * first `await` and both write.
 */
export interface FakeInvitationAcceptanceParts {
  readonly tokens: FakeAccountTokenRepository
  /** Only the lookup: the event a grant names must exist, as its foreign key demands. */
  readonly events: Pick<EventRepository, 'findById'>
  readonly users: UserRepository
  readonly memberships: MembershipRepository
  readonly clients: ClientRepository
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
    const { tokens, events, users, memberships, clients } = this.parts
    const { account, grant, now } = record

    const token = tokens.all.find((candidate) => candidate.id === record.tokenId)
    if (token === undefined || !isAccountTokenUsable(token, now)) return 'spent'

    if (account.kind === 'new' && (await users.findByEmail(account.user.email)) !== null) {
      return 'emailTaken'
    }

    // The foreign keys the adapter has, checked before the first write so a failure leaves
    // nothing behind, as its rollback does.
    const userId = account.kind === 'new' ? account.user.id : account.userId
    if (account.kind === 'existing' && (await users.findById(userId)) === null) {
      throw new Error('FOREIGN KEY constraint failed: the account does not exist')
    }
    const placeExists =
      grant.kind === 'event'
        ? (await events.findById(grant.eventId)) !== null
        : (await clients.findById(grant.clientId)) !== null
    if (!placeExists) throw new Error('FOREIGN KEY constraint failed: the place does not exist')

    await tokens.consume(record.tokenId, now)

    if (account.kind === 'new') {
      await users.save(account.user)
    } else if (account.emailVerifiedAt !== null) {
      const existing = await users.findById(userId)
      if (existing !== null) await users.save(existing.verifyEmail(account.emailVerifiedAt))
    }

    // `INSERT OR IGNORE`: a role already held in this place is left as it is.
    if (grant.kind === 'event') {
      if ((await memberships.membershipFor(grant.eventId, userId)) === null) {
        await memberships.grant({
          eventId: grant.eventId,
          userId,
          role: grant.role,
          grantedAt: now,
        })
      }
    } else if ((await clients.memberRole(grant.clientId, userId)) === null) {
      await clients.grantMember({
        clientId: grant.clientId,
        userId,
        role: grant.role,
        grantedAt: now,
      })
    }
    return 'accepted'
  }
}
