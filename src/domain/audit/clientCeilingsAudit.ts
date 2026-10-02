import type { Client } from '../clients/client'
import type { ClientCeilingsProps } from '../clients/clientCeilings'
import type { AuditAction } from './auditAction'
import type { AuditDetails } from './auditDetails'

/**
 * What a change of a client's ceilings is worth writing down (roadmap §10.5 and §10.8).
 *
 * The rule, kept here rather than in `setClientCeilings` so it is a plain function with a
 * plain test:
 *
 * - **Nothing changed, nothing written.** A patch that restates the current values is not
 *   an act on the client, and an audit log that records it is a log nobody reads.
 * - **A ceiling changed: `client.ceilingsChanged {before, after}`**, both full snapshots.
 * - **The period moved: `client.periodReset {before, after}`**, written *as well*. A renewal
 *   zeroes the counter of events created in the period, and that zeroing is the part a
 *   client disputes, so it gets a line of its own with the counter on both sides.
 */

export interface PlannedAuditEntry {
  readonly action: Extract<AuditAction, 'client.ceilingsChanged' | 'client.periodReset'>
  readonly details: AuditDetails
}

const instantText = (instant: Date | null): string | null =>
  instant === null ? null : instant.toISOString()

/**
 * Written key by key rather than spread from the props, so a field added to
 * `ClientCeilingsProps` is a decision made here and in `AUDIT_ACTIONS` — `auditAction.test.ts`
 * holds the two lists equal — and not a key that starts appearing in a client's trail by
 * accident.
 */
const ceilingsSnapshot = (ceilings: ClientCeilingsProps): AuditDetails => ({
  maxEvents: ceilings.maxEvents,
  maxTotalBytes: ceilings.maxTotalBytes,
  maxEventQuotaBytes: ceilings.maxEventQuotaBytes,
  maxRetentionDays: ceilings.maxRetentionDays,
  clipsAllowed: ceilings.clipsAllowed,
  liveAllowed: ceilings.liveAllowed,
  maxLiveDays: ceilings.maxLiveDays,
  maxEventsPerPeriod: ceilings.maxEventsPerPeriod,
  periodStartedAt: instantText(ceilings.periodStartedAt),
})

const periodSnapshot = (client: Client): AuditDetails => ({
  periodStartedAt: instantText(client.ceilings.periodStartedAt),
  eventsCreatedInPeriod: client.eventsCreatedInPeriod,
})

/** Equal snapshots serialise equal: both come out of the same function, key order fixed. */
const same = (left: AuditDetails, right: AuditDetails): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export const describeCeilingsChange = (before: Client, after: Client): PlannedAuditEntry[] => {
  const planned: PlannedAuditEntry[] = []

  const ceilingsBefore = ceilingsSnapshot(before.ceilings.toProps())
  const ceilingsAfter = ceilingsSnapshot(after.ceilings.toProps())
  if (!same(ceilingsBefore, ceilingsAfter)) {
    planned.push({
      action: 'client.ceilingsChanged',
      details: { before: ceilingsBefore, after: ceilingsAfter },
    })
  }

  if (
    instantText(before.ceilings.periodStartedAt) !== instantText(after.ceilings.periodStartedAt)
  ) {
    planned.push({
      action: 'client.periodReset',
      details: { before: periodSnapshot(before), after: periodSnapshot(after) },
    })
  }

  return planned
}
