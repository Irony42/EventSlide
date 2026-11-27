import type { AuditAction } from '../../../domain/audit/auditAction'
import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { AuditEntry } from '../../../domain/audit/auditEntry'
import { parseHostReason } from '../../../domain/notices/hostReason'
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
  readonly subject: { readonly type: 'photo' | 'event' | 'guestbook'; readonly id: string }
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

/**
 * What an operator act that may tell the host takes besides its target (spec 32, A4): whether to tell them (`notifyHost`,
 * **ticked unless the operator says otherwise**: the console's "Prévenir l'hôte") and the **reason for the host**, a field of its own,
 * distinct from the audit reason (`reason`) which the host never reads. Both optional.
 */
export interface HostNotice {
  readonly notifyHost?: boolean | undefined
  /** At most 500 characters once folded to lines (`parseHostReason`). */
  readonly hostReason?: string | undefined
}

/**
 * The notice's two fields, judged **before anything is read** (a reason that is too long is `400 takedown.hostReasonInvalid`
 * whether or not the host is to be told). What was typed for a host who is not to be told is never used: nothing is sent.
 */
export const parseHostNotice = (
  input: HostNotice,
): Result<{ readonly tell: boolean; readonly reason: string | null }, DomainError> => {
  const reason = parseHostReason(input.hostReason)
  if (!reason.ok) return reason
  return ok({ tell: input.notifyHost !== false, reason: reason.value })
}
