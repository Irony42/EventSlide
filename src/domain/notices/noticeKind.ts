/**
 * The notices the box writes to a host (spec 32, ADR 0019), as the ledger names them: one `kind` per
 * moment, and a `key` that makes one notice of that kind unique (`event_mail_notices`, migration 042).
 *
 * The list grows with the spec's later pull requests, and the table has no `CHECK` on it (SQLite changes a
 * `CHECK` only by rebuilding the table, the lesson of `audit_log`): **this is where the vocabulary is judged**,
 * and the ledger's contract refuses a kind that is not here.
 *
 * - `rsvpErasure`: the replies will be erased (R1, no family: like the purge notice, it is not switchable);
 * - `rsvpDeadline`, `rsvpStopped`, `rsvpFull`: the replies' calendar (R3, R4, R5, family `rsvp`);
 * - `eventClosed`, `windowEnding`, `jobDone`: the life of the event (A3, A5, A2, family `event`).
 *
 * The daily digest (R2), the account notices (A1), the invitation accepted (A6) and the operator's
 * (A4, A8) do not go through the ledger: each has its own guard (the digest's compare-and-set, the
 * action itself, a decision of the operator).
 */
export const NOTICE_KINDS = [
  'rsvpErasure',
  'rsvpDeadline',
  'rsvpStopped',
  'rsvpFull',
  'eventClosed',
  'windowEnding',
  'jobDone',
] as const

export type NoticeKind = (typeof NOTICE_KINDS)[number]

export const isNoticeKind = (value: unknown): value is NoticeKind =>
  typeof value === 'string' && (NOTICE_KINDS as readonly string[]).includes(value)

/**
 * What a host's switch turns off (spec 32, section 5). `rsvp` and `event` are the two switches of the
 * account's page, `announcement` is the operator's (lot 2, A8, which the host does not switch).
 * A notice with no family (R1, A1, A4) is never switchable.
 */
export const MAIL_FAMILIES = ['rsvp', 'event', 'announcement'] as const

export type MailFamily = (typeof MAIL_FAMILIES)[number]

const FAMILY_OF: Readonly<Record<NoticeKind, MailFamily | null>> = {
  rsvpErasure: null,
  rsvpDeadline: 'rsvp',
  rsvpStopped: 'rsvp',
  rsvpFull: 'rsvp',
  eventClosed: 'event',
  windowEnding: 'event',
  jobDone: 'event',
}

/** The family a notice belongs to, or `null` when the host cannot switch it off. */
export const familyOf = (kind: NoticeKind): MailFamily | null => FAMILY_OF[kind]
