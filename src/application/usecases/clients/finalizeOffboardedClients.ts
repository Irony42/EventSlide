import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { ClientId, UserId } from '../../../domain/shared/ids'
import type { AccountHoldings } from '../../ports/accountHoldings'
import type { AuditRecorder } from '../../ports/auditLog'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { UserRepository } from '../../ports/userRepository'

/** At most this many clients per sweep: the sweep deletes accounts, and a backlog should not hold the box. */
export const FINALIZE_BATCH = 20

/** The one actor of the sweep: a constant a programmer chose, never text from a request. */
const SWEEPER = { kind: 'system', label: 'retention-sweeper' } as const

export interface FinalizeOffboardedClientsReport {
  readonly finalized: readonly ClientId[]
  /** Accounts deleted along with them, across all of them. */
  readonly accountsDeleted: number
  /** Clients that could not be finished this time; the next sweep tries again. */
  readonly failed: readonly ClientId[]
}

export interface FinalizeOffboardedClientsDeps {
  readonly clients: ClientRepository
  readonly users: UserRepository
  readonly holdings: AccountHoldings
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type FinalizeOffboardedClients = () => Promise<FinalizeOffboardedClientsReport>

/**
 * The end of an offboarding (G2-14 part 3): run by the retention sweep after it purged the events
 * that were due, for each client whose purge date has passed and that holds no event any more.
 *
 * Of its members, **the accounts that were nothing but this client's are deleted** and the others
 * are kept, because deleting an account is the one thing here that cannot be taken back. An account
 * is kept when it is an operator, belongs to another client, owns an event, wrote media or has a part
 * in some event (anything still hanging from it is somebody else's). Whatever is kept is only
 * removed from this client. Then the client row goes, which takes its invitations and memberships
 * with it by cascade.
 *
 * One `account.deleted` line per account and one `client.finalized` for the client, by the `system`
 * actor labelled `retention-sweeper`, each recorded **before** the row it describes is deleted.
 * The lines carry the client's id, which is by then a pseudonym: nothing answers to it any more.
 *
 * Not a `Result`, like the purge: a client that fails is reported and tried again, and does not stop
 * the next one. `scripts/userDeletionScope.test.ts` names this file as one of the two that may
 * delete an account.
 */
export const makeFinalizeOffboardedClients =
  ({
    clients,
    users,
    holdings,
    audit,
    clock,
  }: FinalizeOffboardedClientsDeps): FinalizeOffboardedClients =>
  async () => {
    const due = await clients.listDueForFinalization(clock.now(), FINALIZE_BATCH)

    const finalized: ClientId[] = []
    const failed: ClientId[] = []
    let accountsDeleted = 0

    const goesWithTheClient = async (clientId: ClientId, userId: UserId): Promise<boolean> => {
      const user = await users.findById(userId)
      if (user === null || user.isOperator()) return false
      const elsewhere = (await clients.membershipsForUser(userId)).some(
        (membership) => membership.clientId !== clientId,
      )
      if (elsewhere) return false
      const held = await holdings.countFor(userId)
      return held.events === 0 && held.media === 0 && held.eventMemberships === 0
    }

    for (const clientId of due) {
      try {
        for (const userId of await clients.memberIds(clientId)) {
          if (!(await goesWithTheClient(clientId, userId))) continue
          const line = AuditEntry.create({
            at: clock.now(),
            actor: SWEEPER,
            action: 'account.deleted',
            subject: { type: 'account', id: userId },
            clientId,
            details: {},
          })
          if (!line.ok) throw new Error(line.error.code)
          await audit.record(line.value)
          await users.delete(userId)
          accountsDeleted += 1
        }
        for (const userId of await clients.memberIds(clientId)) {
          await clients.revokeMember(clientId, userId)
        }

        const done = AuditEntry.create({
          at: clock.now(),
          actor: SWEEPER,
          action: 'client.finalized',
          subject: { type: 'client', id: clientId },
          clientId,
          details: {},
        })
        if (!done.ok) throw new Error(done.error.code)
        await audit.record(done.value)

        if (await clients.deleteIfEmpty(clientId)) finalized.push(clientId)
        else failed.push(clientId)
      } catch {
        failed.push(clientId)
      }
    }

    return { finalized, accountsDeleted, failed }
  }
