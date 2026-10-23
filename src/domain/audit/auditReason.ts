import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * The reason an operator gives for an act on a client (roadmap §10.5 and §10.8; free plan
 * G2-14, paid plan P3-13; decided 2026-10-23): **the one place the audit log holds text a
 * person typed.**
 *
 * Everything else in an entry's `details` is a number, a switch or an instant, because an audit
 * row is read by people who may not read the thing it is about, and a free field is where a
 * guest's name, an address or a caption ends up. A reason is different on purpose: "why did you
 * lower that ceiling" is the question a client puts to its operator, and an act with no answer
 * to it is the one an audit trail exists to prevent. So it is let in, **with a kind of its own
 * and a bound**, and not slipped into an existing declaration.
 *
 * ## What it is held to
 *
 * - **Present.** A blank reason is no reason: the operator's route answers `400` without one.
 * - **At most {@link AUDIT_REASON_MAX_LENGTH} characters, on one line.** A sentence, not a
 *   document; a line break, a control character, a line or paragraph separator and the invisible
 *   formatting characters (a right-to-left override that reorders what a reader sees, a
 *   zero-width space) are refused, because none of them is something an operator types to
 *   explain themselves and each is something that hides what was typed.
 * - **No `@`.** The log has no word for an address, and a reason is the one field that could
 *   hold one. This is a guard against the slip (pasting the client's address into the box), not
 *   against a determined writer: an operator who spells an address out has been trusted with a
 *   free text field and has chosen to misuse it, and the line that records it is theirs.
 * - **Canonical.** Trimmed and NFC-normalised, so two spellings of one sentence are one string
 *   and a reason has no leading or trailing blank to hide behind.
 *
 * It is the operator's own words about their own act. **A client's owner does not read it**:
 * the client-readable view drops every string that is not an instant (`readableDetails`), so an
 * internal note cannot reach the person it is about by accident.
 */

export const AUDIT_REASON_MAX_LENGTH = 200

/** A control character, a separator, or an invisible formatting character. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

export const parseAuditReason = (raw: unknown): Result<string, DomainError> => {
  // A caller the types cannot see: a body that arrived as JSON and was never parsed.
  if (typeof raw !== 'string') {
    return err(DomainError.invalid('audit.reasonInvalid', { max: AUDIT_REASON_MAX_LENGTH }))
  }
  const reason = raw.normalize('NFC').trim()
  if (
    reason.length === 0 ||
    reason.length > AUDIT_REASON_MAX_LENGTH ||
    HIDDEN.test(reason) ||
    reason.includes('@')
  ) {
    return err(DomainError.invalid('audit.reasonInvalid', { max: AUDIT_REASON_MAX_LENGTH }))
  }
  return ok(reason)
}

/** Whether a string is exactly what {@link parseAuditReason} would have kept of itself. */
export const isCanonicalReason = (value: string): boolean => {
  const parsed = parseAuditReason(value)
  return parsed.ok && parsed.value === value
}
