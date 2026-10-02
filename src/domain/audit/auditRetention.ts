/**
 * How long the audit log keeps a row (roadmap §10.8; paid plan P3-07, `AUDIT_RETENTION_DAYS`).
 *
 * **A floor, not a default.** The log exists so that "who changed that ceiling, and when"
 * has an answer; a retention an operator could set to a week would let the instance forget
 * an action within the window a client is still entitled to dispute it. 365 days is the
 * least the plan allows, and it is what the hosted instance runs (G2-06). The default for
 * everyone else is three years, which is what the paid plan's retention matrix (P0-10)
 * works from.
 *
 * The ceiling, ten years, is not a rule of the plan: it keeps `now - days` a representable
 * date and refuses an absurd value at boot rather than overflowing quietly. It is the same
 * ten years `clients.max_retention_days` stops at.
 */

export const AUDIT_RETENTION_MIN_DAYS = 365
export const AUDIT_RETENTION_DEFAULT_DAYS = 1095
export const AUDIT_RETENTION_MAX_DAYS = 3650

const MS_PER_DAY = 24 * 60 * 60 * 1_000

export const isValidAuditRetentionDays = (days: number): boolean =>
  Number.isInteger(days) && days >= AUDIT_RETENTION_MIN_DAYS && days <= AUDIT_RETENTION_MAX_DAYS

/**
 * The instant before which a row is old enough to go, measured from the clock the caller
 * hands in. A row stamped **exactly** at the cutoff is kept: it is `days` old, not older.
 *
 * `now` is always the injected `Clock`'s, never SQLite's `datetime('now')`: a row written
 * at a fixture's fixed instant would otherwise become deletable as the real calendar
 * advanced, and a contract suite written against such a clock would be a time bomb.
 *
 * The caller has already refused an invalid `days` ({@link isValidAuditRetentionDays}).
 */
export const auditRetentionCutoff = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * MS_PER_DAY)
