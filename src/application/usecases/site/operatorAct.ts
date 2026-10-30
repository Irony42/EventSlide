import type { AuditAction } from '../../../domain/audit/auditAction'
import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { DomainError } from '../../../domain/shared/errors'
import { ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'

/**
 * What the operator's three "remove without viewing" use cases have in common (launch review S5,
 * G8-03; docs/SECURITY.md §25): `setPhotoTakedown`, `setEventTakedown`, `setEventPurgeHold`.
 *
 * - **By id, and blind.** The operator names a photograph or an event by an id and says why. No
 *   use case here reads a byte, a caption, a name or a slug, and none returns anything but
 *   success: what the operator gets back is `204`, never a row.
 * - **A reason, mandatory** (`parseAuditReason`, the same bounded sentence a ceiling's change
 *   carries): a blank or malformed one is `400 audit.reasonInvalid`, **before** anything is read.
 * - **Idempotent, one line.** Doing what is already done is `ok` and writes nothing, so a retried
 *   request or a double click leaves one line and keeps the first instant.
 * - **Write-ahead.** The entry is built, so validated, and recorded before the lever moves: an act
 *   cannot happen without a line saying who did it, and an actor the log will not accept refuses
 *   the act.
 * - **Not in the client's trail.** The entry carries **no client id**. The client-readable view
 *   filters on it, so the host is not told, which is the runbook's rule for the case these levers
 *   exist for (`csam.md`: do not warn the host, who may be the person concerned). The operator's
 *   own view of the whole log shows the line.
 */

/** What every one of the three takes besides its target. */
export interface OperatorActInput {
  /** The operator's own sentence, mandatory and bounded (`parseAuditReason`). */
  readonly reason: string
  readonly actor: AuditActorInput
}

export interface OperatorActLine {
  readonly at: Date
  readonly actor: AuditActorInput
  readonly action: AuditAction
  readonly subject: { readonly type: 'photo' | 'event'; readonly id: string }
  /** Already parsed by `parseAuditReason`. */
  readonly reason: string
}

/** Builds the line and records it. `ok` is the moment the caller may move its lever. */
export const recordOperatorAct = async (
  audit: AuditRecorder,
  line: OperatorActLine,
): Promise<Result<void, DomainError>> => {
  const entry = AuditEntry.create({
    at: line.at,
    actor: line.actor,
    action: line.action,
    subject: line.subject,
    clientId: null,
    details: { reason: line.reason },
  })
  if (!entry.ok) return entry

  await audit.record(entry.value)
  return ok(undefined)
}
