import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AccountHoldings } from '../../ports/accountHoldings'
import type { AuditRecorder } from '../../ports/auditLog'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { UserRepository } from '../../ports/userRepository'
import { accountActEntries } from '../auth/accountActAudit'

export interface DeleteAccountInput {
  readonly userId: UserId
  /** The operator who answers the person's request. A required input. */
  readonly actor: AuditActorInput
}

export interface DeleteAccountDeps {
  readonly users: UserRepository
  readonly clients: Pick<
    ClientRepository,
    'membershipsForUser' | 'memberIds' | 'memberRole' | 'countEvents'
  >
  readonly holdings: AccountHoldings
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type DeleteAccount = (input: DeleteAccountInput) => Promise<Result<void, DomainError>>

/**
 * Deletes an account, for a person's erasure request (GDPR, G2-14 part 3). One of the two places
 * the product deletes an account, the other being `finalizeOffboardedClients`;
 * `scripts/userDeletionScope.test.ts` holds that list, and it is a tripwire on purpose.
 *
 * What it refuses, in this order, each with a code the operator can read:
 *
 * - `404 user.notFound`.
 * - `403 account.operatorProtected`: an operator's account is not deleted from here, for the
 *   reason it is not switched off from here.
 * - `409 account.holdsEvents`: the account **owns** an event. The foreign key refuses it too
 *   (`ON DELETE RESTRICT`); the use case says so first, with a code, because an album is somebody's
 *   and erasing a person does not decide what becomes of it. Hand the event over, or purge it.
 * - `409 account.holdsMedia`: the account **wrote** photographs or clips. Deleting it would cascade
 *   through their rows and leave their files on disk, which is a leak and not an erasure.
 * - `409 account.holdsReviews`: the account **reviewed** photographs. Their rows name the reviewer and
 *   the schema refuses a host review with none, so the delete would abort in the database. Not here:
 *   erasing a moderator who has reviewed, which needs a schema change to that constraint.
 * - `409 account.lastClientOwner`: the account is the **only owner of a client that still has other
 *   members or an event**. Operator rule R1 makes every invitation into such a client wait for an owner's
 *   approval, so with no owner left nobody could be added through the API and the client would be
 *   orphaned for good. Add another owner first, or offboard the client.
 *
 * What it does: records one `account.deleted` line per client the account belonged to (or one with
 * no client), **then** deletes. The deletion removes the rows that hang from the account (its
 * memberships, invitations written to it, second factor and share links) and sets to null the
 * actor pointer of every audit line it ever wrote, which is the whole of the erasure on the log's
 * side: the lines stay, and nothing on them says who. **What this does not erase**, and says so: the
 * address is also written into the account's live sessions (`sessions.data`, until they expire, seven
 * days at most) and into the invitation and reset links ever written to it (`account_tokens.email`,
 * until the opportunistic expiry sweep removes them). A session whose account is gone grants nothing.
 */
export const makeDeleteAccount =
  ({ users, clients, holdings, audit, clock }: DeleteAccountDeps): DeleteAccount =>
  async ({ userId, actor }) => {
    const user = await users.findById(userId)
    if (user === null) return err(DomainError.notFound('user.notFound'))
    if (user.siteRole === 'operator') return err(DomainError.forbidden('account.operatorProtected'))

    const held = await holdings.countFor(userId)
    if (held.events > 0) return err(DomainError.conflict('account.holdsEvents'))
    if (held.media > 0) return err(DomainError.conflict('account.holdsMedia'))
    if (held.reviews > 0) return err(DomainError.conflict('account.holdsReviews'))

    // The last owner of a client that is still somebody's account (see the docblock).
    for (const membership of await clients.membershipsForUser(userId)) {
      if (membership.role !== 'owner') continue
      const members = await clients.memberIds(membership.clientId)
      const owners = (
        await Promise.all(members.map((member) => clients.memberRole(membership.clientId, member)))
      ).filter((role) => role === 'owner')
      const inUse = members.length > 1 || (await clients.countEvents(membership.clientId)) > 0
      if (owners.length === 1 && inUse) return err(DomainError.conflict('account.lastClientOwner'))
    }

    const entries = await accountActEntries(clients, {
      userId,
      action: 'account.deleted',
      actor,
      at: clock.now(),
    })
    if (!entries.ok) return entries

    for (const entry of entries.value) await audit.record(entry)
    await users.delete(userId)
    return ok(undefined)
  }
