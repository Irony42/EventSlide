import { DomainError } from '../shared/errors'
import type { UserId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'

/**
 * Who did it, as the audit log records it (roadmap §10.8; paid plan P3-07).
 *
 * Four kinds, the four values of the `audit_log.actor_kind` `CHECK`:
 *
 * - `operator`: the account that runs the box (roadmap §10.1), acting through `/api/site`.
 * - `member`: a client's own account acting on its own client, or, from §5.4 on, a
 *   moderator acting on a photograph.
 * - `system`: this process, with nobody at the keyboard — the retention sweeper closing an
 *   event that outstayed its live window.
 * - `integration`: another program talking to this one, the cloud's Stripe webhook being
 *   the case the paid plan names. It carries a label because it has no account to point at.
 *
 * **The `userId` is a pseudonym that outlives its owner.** The column is `ON DELETE SET
 * NULL`, so a deleted account leaves the entry and loses the pointer, which is the whole
 * erasure procedure (there is nothing else about a person in a row). A record read back can
 * therefore carry `kind: 'operator'` with a `null` `userId`; an entry being **written** may
 * not, because "an operator did this, nobody knows who" is not something a use case can
 * truthfully say at the moment it happens.
 */

export const AUDIT_ACTOR_KINDS = ['operator', 'member', 'system', 'integration'] as const

export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number]

export const isAuditActorKind = (value: unknown): value is AuditActorKind =>
  typeof value === 'string' && (AUDIT_ACTOR_KINDS as readonly string[]).includes(value)

export interface AuditActor {
  readonly kind: AuditActorKind
  readonly userId: UserId | null
  readonly label: string | null
}

export interface AuditActorInput {
  readonly kind: AuditActorKind
  readonly userId?: UserId | null
  readonly label?: string | null
}

/** The `CHECK (length(actor_label) <= 80)`. */
export const AUDIT_LABEL_MAX_LENGTH = 80

/**
 * A label is a constant a programmer chose (`cloud:stripe-webhook`, `retention-sweeper`),
 * never text from a request. The alphabet says so: no space, no `@`, so neither a name nor
 * an address fits.
 */
const LABEL_PATTERN = new RegExp(`^[A-Za-z0-9:._-]{1,${AUDIT_LABEL_MAX_LENGTH}}$`)

/** Accounts act as themselves; a process and an integration have no account to name. */
const ACTS_AS_AN_ACCOUNT: ReadonlySet<AuditActorKind> = new Set(['operator', 'member'])

export const parseAuditActor = (input: AuditActorInput): Result<AuditActor, DomainError> => {
  if (!isAuditActorKind(input.kind)) return err(DomainError.invalid('audit.actorKindInvalid'))

  const userId = input.userId ?? null
  const label = input.label ?? null

  if (ACTS_AS_AN_ACCOUNT.has(input.kind) && userId === null) {
    return err(DomainError.invalid('audit.actorUserRequired'))
  }
  if (!ACTS_AS_AN_ACCOUNT.has(input.kind) && userId !== null) {
    return err(DomainError.invalid('audit.actorUserForbidden'))
  }
  if (label !== null && !LABEL_PATTERN.test(label)) {
    return err(DomainError.invalid('audit.actorLabelInvalid', { max: AUDIT_LABEL_MAX_LENGTH }))
  }
  if (input.kind === 'integration' && label === null) {
    return err(DomainError.invalid('audit.actorLabelRequired'))
  }

  return ok({ kind: input.kind, userId, label })
}
