import { DomainError } from '../shared/errors'
import type { ClientId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import { AUDIT_ACTIONS, isAuditAction, type AuditAction } from './auditAction'
import { parseAuditActor, type AuditActor, type AuditActorInput } from './auditActor'
import { AUDIT_ID_PATTERN, validateDetails, type AuditDetails } from './auditDetails'
import type { AuditSubjectType } from './auditSubjectType'

/**
 * One line of the audit log, before it is written (roadmap §10.8; paid plan P3-07).
 *
 * **A private constructor, so that the port cannot be handed anything this file has not
 * vouched for.** `AuditLog.record` takes an `AuditEntry`, and the only way to hold one is
 * {@link AuditEntry.create}, which refuses an action nobody declared, an action about the
 * wrong kind of subject, an actor who does not make sense, and a `details` that is not
 * exactly the shape the action declares. An adapter therefore never needs to re-validate,
 * and a use case never needs to remember to.
 *
 * Reading the log back is a different shape (`AuditRecord`, in the port): it adds the
 * sequence number the database assigned, and it does not re-run any of this, because a row
 * written under an older version of the allow-list must stay readable by a newer one.
 */

export interface AuditSubject {
  readonly type: AuditSubjectType
  /** An opaque id the system generated, never a name or a slug. */
  readonly id: string
}

export interface AuditEntryProps {
  readonly at: Date
  readonly actor: AuditActor
  readonly action: AuditAction
  readonly subject: AuditSubject
  /**
   * The client this entry belongs to, for the client-readable view (G2-16). `null` for what
   * belongs to no client. Never a foreign key: the history of a client that has since been
   * deleted must outlive the row it describes.
   */
  readonly clientId: ClientId | null
  readonly details: AuditDetails
}

export interface NewAuditEntry {
  readonly at: Date
  readonly actor: AuditActorInput
  readonly action: AuditAction
  readonly subject: AuditSubject
  readonly clientId: ClientId | null
  readonly details: AuditDetails
}

export class AuditEntry {
  private constructor(private readonly props: AuditEntryProps) {}

  static create(input: NewAuditEntry): Result<AuditEntry, DomainError> {
    if (!(input.at instanceof Date) || !Number.isFinite(input.at.getTime())) {
      return err(DomainError.invalid('audit.atInvalid'))
    }

    // The types forbid an unknown action, so this is for the caller the types cannot see:
    // a string that arrived through a cast or a JSON body.
    if (!isAuditAction(input.action)) return err(DomainError.invalid('audit.actionUnknown'))
    const spec = AUDIT_ACTIONS[input.action]

    if (input.subject.type !== spec.subject) {
      return err(DomainError.invalid('audit.subjectTypeMismatch', { expected: spec.subject }))
    }
    if (!AUDIT_ID_PATTERN.test(input.subject.id)) {
      return err(DomainError.invalid('audit.subjectIdInvalid'))
    }

    // An entry about a client that does not carry that client's id would be written
    // happily and then never shown to the one person entitled to read it: the
    // client-readable view filters on `client_id`.
    if (input.subject.type === 'client' && input.clientId !== input.subject.id) {
      return err(DomainError.invalid('audit.clientIdMismatch'))
    }

    const actor = parseAuditActor(input.actor)
    if (!actor.ok) return actor

    const details = validateDetails(spec.details, input.details)
    if (!details.ok) return details

    return ok(
      new AuditEntry({
        at: new Date(input.at.getTime()),
        actor: actor.value,
        action: input.action,
        subject: { type: input.subject.type, id: input.subject.id },
        clientId: input.clientId,
        details: details.value,
      }),
    )
  }

  toProps(): AuditEntryProps {
    return this.props
  }
}
