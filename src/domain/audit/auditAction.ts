import { detail, type DetailFields } from './auditDetails'
import type { AuditSubjectType } from './auditSubjectType'

/**
 * Every action the audit log can record, and what each is allowed to say (roadmap §10.8;
 * paid plan P3-07).
 *
 * **Adding an action is adding a line here**, and that is the whole of the process: the
 * subject it is about, and the exact shape of its details. There is no way to record an
 * action that is not in this table, and no way to attach a detail that its entry does not
 * name. See `auditDetails.ts` for why the vocabulary has no free-text kind.
 *
 * Only actions with a producer in the tree are declared. The plan names many more
 * (`client.created`, `client.suspended`, `invitation.issued`, `account.termsAccepted`,
 * `event.autoClosed`, ...); each arrives with the use case that writes it, together with the
 * test that proves its details carry nothing a person typed, rather than as a guess made
 * before the use case exists.
 *
 * Names are `<subject>.<pastTense>` and are part of what a client's owner will read in
 * G2-16, so renaming one rewrites no history and orphans every row already stored under the
 * old name: add a new action instead.
 */

export interface AuditActionSpec {
  /** The only subject type this action may be about. */
  readonly subject: AuditSubjectType
  /** The exact keys and kinds of `details`. */
  readonly details: DetailFields
}

/**
 * The nine ceilings of `ClientCeilings`, as a snapshot: every key present, `null` meaning
 * "no ceiling". A full snapshot rather than a diff keeps the reader's job simple (the entry
 * says everything that was true) and the validator's too (no key is ever optional). The
 * keys are held equal to `ClientCeilingsProps` by `auditAction.test.ts`, so a tenth ceiling
 * cannot be added without this table, and a change to it, noticing.
 */
const CEILINGS_SNAPSHOT = detail.object({
  maxEvents: detail.nullable(detail.integer),
  maxTotalBytes: detail.nullable(detail.integer),
  maxEventQuotaBytes: detail.nullable(detail.integer),
  maxRetentionDays: detail.nullable(detail.integer),
  clipsAllowed: detail.boolean,
  liveAllowed: detail.boolean,
  maxLiveDays: detail.nullable(detail.integer),
  maxEventsPerPeriod: detail.nullable(detail.integer),
  periodStartedAt: detail.nullable(detail.instant),
})

/** What a period renewal changes: the period's start, and the counter it zeroes. */
const PERIOD_SNAPSHOT = detail.object({
  periodStartedAt: detail.nullable(detail.instant),
  eventsCreatedInPeriod: detail.integer,
})

export const AUDIT_ACTIONS = {
  /** An operator changed what a client may do (`setClientCeilings`). */
  'client.ceilingsChanged': {
    subject: 'client',
    details: { before: CEILINGS_SNAPSHOT, after: CEILINGS_SNAPSHOT },
  },
  /**
   * An operator renewed a client's period, which restarts the count of events created in
   * it. Written beside `client.ceilingsChanged` rather than instead of it, because the
   * counter reset is the part a client disputes ("I had two events left").
   */
  'client.periodReset': {
    subject: 'client',
    details: { before: PERIOD_SNAPSHOT, after: PERIOD_SNAPSHOT },
  },
} as const satisfies Record<string, AuditActionSpec>

export type AuditAction = keyof typeof AUDIT_ACTIONS

export const isAuditAction = (value: unknown): value is AuditAction =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(AUDIT_ACTIONS, value)
