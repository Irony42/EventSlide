import { detail, type DetailFields } from './auditDetails'
import type { AuditSubjectType } from './auditSubjectType'

/**
 * Every action the audit log can record, and what each is allowed to say (roadmap §10.8;
 * paid plan P3-07).
 *
 * **Adding an action is adding a line here**, and that is the whole of the process: the
 * subject it is about, and the exact shape of its details. There is no way to record an
 * action that is not in this table, and no way to attach a detail that its entry does not
 * name. See `auditDetails.ts` for why the vocabulary has no free-text kind, and `auditReason.ts` for
 * the one exception, which exactly one declaration here uses.
 *
 * Only actions with a producer in the tree are declared. The plan names many more
 * (`client.suspended`, `account.termsAccepted`,
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
  /**
   * An operator opened a client (`provisionClientOwner`, G2-09 / G2-18), with the ceilings it
   * started with — the operator's own, or the box's `NEW_CLIENT_*` defaults, or both. The
   * snapshot is the point: the defaults are configuration, which changes at the next boot, and
   * "what was this client promised on the day it was opened" must still have an answer. The
   * client's name and its owner's address are not here: the first is the client's to change and
   * the second is personal data, and the entry's subject already says which client it is.
   */
  'client.created': { subject: 'client', details: { ceilings: CEILINGS_SNAPSHOT } },
  /**
   * An operator changed what a client may do (`setClientCeilings`). `reason` is the operator's
   * own explanation, **mandatory** (decided 2026-10-23: the route answers 400 without one) and
   * the one free-text detail the log holds, with a kind and a bound of its own
   * (`auditReason.ts`). The client's owner is not shown it: the client-readable view drops
   * every string that is not an instant.
   */
  'client.ceilingsChanged': {
    subject: 'client',
    details: { before: CEILINGS_SNAPSHOT, after: CEILINGS_SNAPSHOT, reason: detail.reason },
  },
  /**
   * An operator froze a client (`suspendClient`, G2-14): its public surfaces answer as an unknown
   * event does and its members may read and not write. Written once: suspending a client that is
   * already suspended is not an act and leaves no second line.
   */
  'client.suspended': { subject: 'client', details: {} },
  /**
   * An operator ended a client's engagement (`offboardClient`, G2-14 part 3): its live events were
   * closed, its drafts archived, the client frozen and its albums given a purge date `graceDays`
   * away, which is the window in which the client exports what it wants. The counts say how many
   * events moved; which ones is the content the log does not hold.
   */
  'client.offboarded': {
    subject: 'client',
    details: { graceDays: detail.integer, closed: detail.integer, archived: detail.integer },
  },
  /**
   * The sweep finished an offboarding (`finalizeOffboardedClients`, G2-14 part 3): every event of
   * the client was purged, the accounts that belonged to nothing else were deleted, and the client
   * itself is gone. The subject is now a pseudonym, and the entry is written by `system`.
   */
  'client.finalized': { subject: 'client', details: {} },
  /**
   * An operator took one photograph down by its id, **without opening it** (`setPhotoTakedown`,
   * launch review S5 / G8-03). The subject is the photograph's opaque id; the entry carries no
   * client id, so it is **not** in the client-readable trail (the runbook's "do not tip the host
   * off"), and `reason` is the operator's own bounded sentence, mandatory like a ceiling's.
   */
  'photo.takenDown': { subject: 'photo', details: { reason: detail.reason } },
  /** An operator put a taken-down photograph back (`setPhotoTakedown`). Same shape and visibility. */
  'photo.restored': { subject: 'photo', details: { reason: detail.reason } },
  /** An operator took a whole event down (`setEventTakedown`), by its id. Same shape and visibility. */
  'event.takenDown': { subject: 'event', details: { reason: detail.reason } },
  /** An operator put a taken-down event back (`setEventTakedown`). */
  'event.restored': { subject: 'event', details: { reason: detail.reason } },
  /**
   * An operator held an event's purge, to preserve evidence (`setEventPurgeHold`): the retention
   * sweep skips it and neither its host's purge nor the deletion of one of its photographs goes
   * through. Independent of a takedown.
   */
  'event.purgeHeld': { subject: 'event', details: { reason: detail.reason } },
  /** An operator released that hold (`setEventPurgeHold`): the event is purged at its deadline again. */
  'event.purgeReleased': { subject: 'event', details: { reason: detail.reason } },
  /** An operator lifted a suspension (`resumeClient`, G2-14). */
  'client.resumed': { subject: 'client', details: {} },
  /**
   * An operator renamed a client (`renameClient`, G2-14). The entry says that it happened and
   * to which client, **not what the name was or became**: a name is the client's own text, and
   * the log has no word for one.
   */
  'client.renamed': { subject: 'client', details: {} },
  /**
   * An operator renewed a client's period, which restarts the count of events created in
   * it. Written beside `client.ceilingsChanged` rather than instead of it, because the
   * counter reset is the part a client disputes ("I had two events left").
   */
  'client.periodReset': {
    subject: 'client',
    details: { before: PERIOD_SNAPSHOT, after: PERIOD_SNAPSHOT },
  },
  /**
   * An operator switched an account off (`disableAccount`, G2-08 / P3-09). The subject is
   * the account's opaque id, which is all the entry needs: who it was is in `users`, and
   * the log never holds an address.
   */
  'account.disabled': { subject: 'account', details: {} },
  /** An operator switched an account back on (`enableAccount`, G2-14 part 3). */
  'account.enabled': { subject: 'account', details: {} },
  /**
   * An account was deleted, for a person's erasure request or because its client was finalised
   * (`deleteAccount`, `finalizeOffboardedClients`, G2-14 part 3). The subject is the opaque id the
   * account had, which is now **a pseudonym**: nothing in `users` answers to it any more, and the
   * actor pointer of every line the account ever wrote is nulled by the foreign key. One line per
   * client the account belonged to, carrying that client's id, so the owner's trail says that a
   * member's account is gone; one line with no client for an account that belonged to none.
   */
  'account.deleted': { subject: 'account', details: {} },
  /**
   * An account confirmed an authenticator (`confirmTotpEnrollment`, G2-13 / P3-15). The
   * subject is the account itself: there is nothing else to say, and above all not the
   * secret, the codes or the address.
   */
  'account.secondFactorEnrolled': { subject: 'account', details: {} },
  /**
   * An invitation into a client was written (`inviteToClientAsOperator`, the operator guard's
   * R1; G2-12 / P3-14). `pendingApproval` is the fact the client's owner reads it for: `true`
   * means the invitation is unusable until one of them approves it, which is what R1 requires
   * of an operator's invitation into a client that already has events. The subject is the
   * invitation's id; **never the address it was written to**, and not its role either, since
   * the vocabulary has no word for either.
   */
  'invitation.issued': { subject: 'invitation', details: { pendingApproval: detail.boolean } },
  /**
   * An owner of the client approved an invitation that was waiting for them
   * (`approveInvitation`). The actor is that owner, which is the whole content of the entry.
   */
  'invitation.approved': { subject: 'invitation', details: {} },
  /**
   * An operator asked to reset an account's password on a box that cannot mail the link, with
   * `OPERATOR_RESET_LINKS=copyLinkWithOwnerApproval`, and the request now waits for another
   * owner of the account's client (`issuePasswordResetForAccount`, R2). The subject is the
   * account whose password it is.
   */
  'account.resetRequested': { subject: 'account', details: {} },
  /**
   * An owner of the account's client approved an operator's request for a reset link
   * (`approvePasswordReset`, R2). The actor is that owner.
   */
  'account.resetApproved': { subject: 'account', details: {} },
  /**
   * A password-reset link was issued for an account **by an operator** (R2). `linkShown` says
   * whether the operator was handed the link (`true`, only ever after an owner's approval, on
   * a box with no mail relay and `copyLinkWithOwnerApproval`) or it went to the account's own
   * mailbox and nowhere else (`false`, the default and the rule). A client's owner reads this
   * line to know which of the two happened to their member.
   */
  'account.resetIssued': { subject: 'account', details: { linkShown: detail.boolean } },
  /**
   * A person accepted the terms of use by accepting an invitation (`acceptInvitation`, G2-20),
   * on a box that sets `LEGAL_TERMS_URL` and `LEGAL_TERMS_VERSION`. The subject is the account
   * that accepted and the client is the one the invitation was into (or the event's), so the
   * client's owner reads it (G2-16). `version` is the box's own, as it was when they agreed:
   * what a dispute needs ("which text did they accept?") and nothing that a person typed.
   * Written in the transaction that spends the link, so there is no acceptance without it and
   * no entry without an acceptance.
   */
  'account.termsAccepted': { subject: 'account', details: { version: detail.termsVersion } },
  /** An account removed its authenticator and its recovery codes (`disableSecondFactor`). */
  'account.secondFactorDisabled': { subject: 'account', details: {} },
  /** An account replaced its set of recovery codes (`regenerateRecoveryCodes`). */
  'account.recoveryCodesRegenerated': { subject: 'account', details: {} },
  /**
   * A recovery code was spent, to sign in or to confirm a step (`verifySecondFactor`). It
   * says how many are left, because a person down to their last code should be told by the
   * log as well as by the screen: a number, never a code.
   */
  'account.recoveryCodeUsed': { subject: 'account', details: { remaining: detail.integer } },
} as const satisfies Record<string, AuditActionSpec>

export type AuditAction = keyof typeof AUDIT_ACTIONS

export const isAuditAction = (value: unknown): value is AuditAction =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(AUDIT_ACTIONS, value)
