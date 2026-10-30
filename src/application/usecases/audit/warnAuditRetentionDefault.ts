import { auditRetentionCutoff } from '../../../domain/audit/auditRetention'
import type { AuditLog } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'

export interface WarnAuditRetentionDefaultDeps {
  readonly audit: Pick<AuditLog, 'oldestAt'>
  readonly clock: Clock
  readonly logger: Pick<Logger, 'warn'>
  /** The retention in force, in days. */
  readonly retentionDays: number
  /** Whether `AUDIT_RETENTION_DAYS` was left unset (or blank), so the default applies. */
  readonly fromDefault: boolean
}

/**
 * Says so, once, when the audit retention default is about to delete rows an older version kept.
 *
 * The default went from 1095 to 365 days (3.3). A box that never set `AUDIT_RETENTION_DAYS` and
 * has rows older than a year would lose them at its first retention sweep without having asked:
 * that is the one case worth a line in the boot log, naming the variable. Called at boot, before the
 * sweeper exists. A box that set the variable has decided, and a box with nothing old has nothing
 * to lose; neither is warned. Returns whether it warned.
 */
export const makeWarnAuditRetentionDefault =
  ({ audit, clock, logger, retentionDays, fromDefault }: WarnAuditRetentionDefaultDeps) =>
  async (): Promise<boolean> => {
    if (!fromDefault) return false
    const oldest = await audit.oldestAt()
    if (oldest === null) return false
    const cutoff = auditRetentionCutoff(clock.now(), retentionDays)
    if (oldest.getTime() >= cutoff.getTime()) return false

    logger.warn(
      'the audit log holds rows older than the retention default, which will delete them',
      {
        detail:
          `AUDIT_RETENTION_DAYS is not set, so audit rows are kept ${retentionDays} days (the default ` +
          'was 1095 before 3.3) and the oldest row is older than that: the next retention sweep removes ' +
          'it. Set AUDIT_RETENTION_DAYS=1095 (365 to 3650) to keep them longer.',
        oldestRowAt: oldest.toISOString(),
      },
    )
    return true
  }
