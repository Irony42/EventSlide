import {
  AUDIT_RETENTION_MAX_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
  auditRetentionCutoff,
  isValidAuditRetentionDays,
} from '../../../domain/audit/auditRetention'
import type { AuditLog } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'

/**
 * Forgets the audit rows that have outlived `AUDIT_RETENTION_DAYS` (roadmap §10.8; paid plan
 * P3-07).
 *
 * **The only way a row ever leaves the log.** The port has no delete, the table refuses a
 * raw `DELETE`, and the one door the schema leaves open is opened by the adapter inside
 * this call and nowhere else. `src/main/retentionSweeper.ts` is its caller, once per
 * sweep. No actor and no route: it drains nothing that belongs to a request, and it is not
 * something an operator should be able to trigger over the wire.
 *
 * **Age is measured on the injected clock.** Never on the database's: rows written at a
 * fixture's fixed instant would otherwise become deletable as the real calendar advanced,
 * and every test against them a time bomb with a date on it.
 *
 * **It refuses to be built with a retention below the floor.** Configuration is already
 * refused at boot (`AUDIT_RETENTION_DAYS`, 365 at least), so reaching here with 30 is a
 * wiring bug, and the safe answer to a wiring bug in a *deleter* is not to build it. A
 * pruner that quietly clamped to the floor would hide the bug; one that deleted at 30 days
 * would have erased evidence the plan promises to keep.
 */

export interface PruneAuditLogDeps {
  /** Only the one method it needs, so the rest of the port is not reachable from here. */
  readonly audit: Pick<AuditLog, 'pruneOlderThan'>
  readonly clock: Clock
  readonly retentionDays: number
}

export interface PruneAuditLogReport {
  /** How many rows were removed. */
  readonly pruned: number
  /** Rows stamped strictly before this instant were old enough to go. */
  readonly cutoff: Date
}

export type PruneAuditLog = () => Promise<PruneAuditLogReport>

export const makePruneAuditLog = ({
  audit,
  clock,
  retentionDays,
}: PruneAuditLogDeps): PruneAuditLog => {
  if (!isValidAuditRetentionDays(retentionDays)) {
    throw new RangeError(
      `The audit log is kept for a whole number of days from ${AUDIT_RETENTION_MIN_DAYS} to ` +
        `${AUDIT_RETENTION_MAX_DAYS}, got ${retentionDays}`,
    )
  }

  return async () => {
    const cutoff = auditRetentionCutoff(clock.now(), retentionDays)
    return { pruned: await audit.pruneOlderThan(cutoff), cutoff }
  }
}
