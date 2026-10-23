import { DomainError } from '../shared/errors'
import type { ClientRole } from '../clients/clientRole'
import type { AccountTokenId, ClientId, EventId, UserId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import type { EmailAddress } from './emailAddress'

/**
 * An account token (docs/ROADMAP.md §10.3; free plan G2-08, paid plan P3-09): a one-use,
 * short-lived link that proves its holder controls a mailbox.
 *
 * **An invitation is a password reset for an account that does not exist yet**, and an
 * e-mail verification is the same proof with nothing to choose afterwards. So the three
 * purposes share one record, one lifetime rule and one definition of "usable", rather than
 * three near-copies of the code that decides whether a stranger's request may change who can
 * sign in. `passwordReset` and `invitation` are spent today; `emailVerification` is here
 * because its columns are (migration 010) and because a rule written once is audited once.
 *
 * ## What the record is, and is not
 *
 * It holds the token's **digest**, never the token. The token is 256 random bits that exist
 * in a mail, a link and the browser of the person it was sent to, and nowhere else: a
 * database dump, a backup archive or a log line holds a SHA-256 that opens nothing. The
 * digest is a fast hash on purpose — the secret is random, not chosen, so there is nothing
 * to brute-force — and it is what makes the lookup an index seek.
 *
 * It is immutable. A token is spent, approved or revoked by a single conditional statement
 * in the repository, never by reading it, changing it and saving it back: the second of two
 * concurrent spends must lose, and only the database can say which one that was.
 */

export const ACCOUNT_TOKEN_PURPOSES = ['invitation', 'passwordReset', 'emailVerification'] as const

export type AccountTokenPurpose = (typeof ACCOUNT_TOKEN_PURPOSES)[number]

export const isAccountTokenPurpose = (value: unknown): value is AccountTokenPurpose =>
  typeof value === 'string' && (ACCOUNT_TOKEN_PURPOSES as readonly string[]).includes(value)

const HOUR_MS = 60 * 60 * 1000

/**
 * How long each purpose stays usable, from the moment it is issued.
 *
 * A reset is an hour: it is asked for by someone sitting at the form, and a link that is
 * still good tomorrow is a password sitting in a mailbox. An invitation is a week because
 * the person it is for has to find it. A verification is a day.
 *
 * **Fixed by the domain, not by the caller.** {@link issueAccountToken} computes the expiry
 * and takes no `expiresAt`, so no use case can mint a reset link that lives for a month.
 */
export const ACCOUNT_TOKEN_LIFETIME_MS: Readonly<Record<AccountTokenPurpose, number>> = {
  invitation: 7 * 24 * HOUR_MS,
  passwordReset: HOUR_MS,
  emailVerification: 24 * HOUR_MS,
}

/**
 * How many invitations one address can be sent in an hour, whoever sends them (G2-09 /
 * P3-10).
 *
 * An invitation is written by a signed-in host or by the operator, so the per-client limit
 * of the HTTP layer already bounds how fast any one of them can write. It says nothing about
 * **whom**: a host can invite the same stranger to ten events, and every one of those is a
 * mail in that stranger's inbox. This is the cap on the recipient's side. Re-inviting the
 * same address to the same event or client replaces the earlier link, so the common reason to
 * send a second one (the first was lost) costs a slot but never leaves two links alive.
 *
 * Five, because a person who hosts three events with one helper is a real case and ten
 * invitations in an hour to one inbox is not.
 */
export const INVITATION_MAX_PER_ADDRESS_PER_HOUR = 5

/** The window {@link INVITATION_MAX_PER_ADDRESS_PER_HOUR} counts in. */
export const INVITATION_WINDOW_MS = HOUR_MS

/**
 * How many reset mails one address can be sent in an hour (G2-08 / P3-09).
 *
 * The request is unauthenticated and its answer is the same for every address, so a rate
 * limit by client address bounds one attacker's speed and nothing about **whom** they write
 * to: a hundred addresses a minute is a hundred strangers' inboxes. This is the cap on the
 * victim's side — the fourth request inside the hour issues nothing and sends nothing, and
 * answers exactly as the first did, so it is not an oracle either.
 *
 * Three, not one: a person who mistyped their address and tried again, then waited for a
 * slow relay, is not abusing anything.
 */
export const PASSWORD_RESET_MAX_REQUESTS_PER_HOUR = 3

/** The window {@link PASSWORD_RESET_MAX_REQUESTS_PER_HOUR} counts in. */
export const PASSWORD_RESET_REQUEST_WINDOW_MS = HOUR_MS

/**
 * How long a token's row is kept after it can no longer be spent.
 *
 * A row holds an address, so it is housekeeping the moment it is dead. A day is the margin
 * that keeps the request counter honest (it counts rows issued in the last hour, and a reset
 * lives one) and leaves a support conversation something to look at.
 */
export const ACCOUNT_TOKEN_RETENTION_AFTER_EXPIRY_MS = 24 * HOUR_MS

/**
 * How the link was meant to reach its owner: `mail`, or `link` — shown on screen to be
 * copied, because the box has no relay. The distinction is part of the record because
 * receiving a link by mail proves control of the mailbox, and being handed one by the person
 * who created it proves nothing of the kind.
 */
export type AccountTokenDelivery = 'mail' | 'link'

/** The only role an invitation can grant inside an event. */
export type AccountTokenEventRole = 'moderator'

/**
 * What an invitation grants, as exactly one of two things (docs/ROADMAP.md §10.3):
 *
 * - a role inside **one event**, which is only ever `moderator` — an owner is made by
 *   creating the event or by a handover, never by a link; or
 * - a place in **one client's account**, as `owner` or `member` (`domain/clients/clientRole.ts`).
 *
 * The two roles are different vocabularies and are not compared with each other. Neither
 * grants the other: a client's owner is not a moderator of its events by being one.
 */
export type InvitationTarget =
  | { readonly kind: 'event'; readonly eventId: EventId; readonly role: AccountTokenEventRole }
  | { readonly kind: 'client'; readonly clientId: ClientId; readonly role: ClientRole }

/** SHA-256 as lower-case hex: the only shape a stored digest has. */
const TOKEN_DIGEST = /^[0-9a-f]{64}$/

export const isTokenDigest = (value: unknown): value is string =>
  typeof value === 'string' && TOKEN_DIGEST.test(value)

export interface AccountToken {
  readonly id: AccountTokenId
  readonly purpose: AccountTokenPurpose
  readonly tokenDigest: string
  /** Where the link was sent, normalised like an account's address. */
  readonly email: EmailAddress
  /** The account it acts on. `null` for an invitation: there is no account yet. */
  readonly userId: UserId | null
  readonly eventId: EventId | null
  readonly eventRole: AccountTokenEventRole | null
  /** The client an invitation admits its holder to, with `clientRole`. Both or neither. */
  readonly clientId: ClientId | null
  readonly clientRole: ClientRole | null
  readonly delivery: AccountTokenDelivery
  /** Whether somebody other than the creator has to approve it before it can be spent. */
  readonly requiresApproval: boolean
  readonly approvedBy: UserId | null
  readonly approvedAt: Date | null
  /** `null` once the creator's account is gone: the history outlives the person. */
  readonly createdBy: UserId | null
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly consumedAt: Date | null
  readonly revokedAt: Date | null
}

export interface NewAccountToken {
  readonly purpose: AccountTokenPurpose
  readonly tokenDigest: string
  readonly email: EmailAddress
  readonly userId: UserId | null
  readonly eventId?: EventId | null
  readonly eventRole?: AccountTokenEventRole | null
  readonly clientId?: ClientId | null
  readonly clientRole?: ClientRole | null
  readonly delivery: AccountTokenDelivery
  readonly requiresApproval?: boolean
  readonly createdBy: UserId | null
}

/**
 * A freshly issued token: unspent, unrevoked, unapproved, and expiring when its purpose says.
 *
 * Refuses what the database would also refuse (a digest that is not a SHA-256, a purpose it
 * has never heard of), so a use case that built a bad record fails here with a code rather
 * than as a constraint violation, and two things the schema cannot say:
 *
 * - **A reset is for an account.** `passwordReset` without a `userId` would be a token the
 *   spending use case cannot apply to anybody.
 * - **A role needs its target, and a target needs its role.** `eventRole` without
 *   `eventId` grants moderation of nothing; `eventId` without `eventRole` or `clientId`
 *   without `clientRole` names a place and grants nothing in it.
 * - **An invitation names exactly one target and no account.** With none it would admit its
 *   holder to nothing; with two, "which one" would be a question the accepting use case had
 *   to guess. And it is bound to an *address*, not to an account: whether the address has an
 *   account is decided when the link is spent, never recorded when it is written, so a
 *   token cannot be a witness to who already uses the box.
 * - **Nothing else names a target.** A reset or a verification carrying one would be a link
 *   that looks like it grants a role and is spent by something that never reads it.
 */
export const issueAccountToken = (
  input: NewAccountToken,
  id: AccountTokenId,
  now: Date,
): Result<AccountToken, DomainError> => {
  if (!isAccountTokenPurpose(input.purpose)) {
    return err(DomainError.invalid('accountToken.purposeInvalid'))
  }
  if (!isTokenDigest(input.tokenDigest)) {
    return err(DomainError.invalid('accountToken.digestInvalid'))
  }
  if (input.purpose === 'passwordReset' && input.userId === null) {
    return err(DomainError.invalid('accountToken.userRequired'))
  }
  const eventId = input.eventId ?? null
  const eventRole = input.eventRole ?? null
  const clientId = input.clientId ?? null
  const clientRole = input.clientRole ?? null
  if (eventRole !== null && eventId === null) {
    return err(DomainError.invalid('accountToken.eventRequired'))
  }
  if (clientRole !== null && clientId === null) {
    return err(DomainError.invalid('accountToken.clientRequired'))
  }
  if ((eventId !== null && eventRole === null) || (clientId !== null && clientRole === null)) {
    return err(DomainError.invalid('accountToken.roleRequired'))
  }
  const namesEvent = eventId !== null
  const namesClient = clientId !== null
  if (input.purpose === 'invitation') {
    if (!namesEvent && !namesClient) return err(DomainError.invalid('accountToken.targetRequired'))
    if (namesEvent && namesClient) return err(DomainError.invalid('accountToken.targetAmbiguous'))
    if (input.userId !== null) return err(DomainError.invalid('accountToken.userForbidden'))
  } else if (namesEvent || namesClient) {
    return err(DomainError.invalid('accountToken.targetForbidden'))
  }

  return ok({
    id,
    purpose: input.purpose,
    tokenDigest: input.tokenDigest,
    email: input.email,
    userId: input.userId,
    eventId,
    eventRole,
    clientId,
    clientRole,
    delivery: input.delivery,
    requiresApproval: input.requiresApproval ?? false,
    approvedBy: null,
    approvedAt: null,
    createdBy: input.createdBy,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ACCOUNT_TOKEN_LIFETIME_MS[input.purpose]),
    consumedAt: null,
    revokedAt: null,
  })
}

/**
 * Whether this token may be spent at `now`: not spent, not revoked, not expired, and
 * approved if it needed approval.
 *
 * The expiry is exclusive — a token is dead **at** its `expiresAt`, not after it — so "a
 * reset lasts an hour" has no extra millisecond in it.
 *
 * The repository's conditional `UPDATE` states the same predicate in SQL and is the one that
 * decides a real spend; this is the in-memory twin the fake uses, and the shared contract
 * suite runs the same cases against both so they cannot drift.
 */
export const isAccountTokenUsable = (token: AccountToken, now: Date): boolean =>
  token.consumedAt === null &&
  token.revokedAt === null &&
  token.expiresAt.getTime() > now.getTime() &&
  (!token.requiresApproval || token.approvedAt !== null)

/**
 * What an invitation grants, or `null` for a token that is not an invitation. The one place
 * the pair of columns is read as a single thing, so the accepting use case and the mail
 * cannot disagree about which half to look at.
 */
export const invitationTargetOf = (token: AccountToken): InvitationTarget | null => {
  if (token.purpose !== 'invitation') return null
  if (token.eventId !== null && token.eventRole !== null) {
    return { kind: 'event', eventId: token.eventId, role: token.eventRole }
  }
  if (token.clientId !== null && token.clientRole !== null) {
    return { kind: 'client', clientId: token.clientId, role: token.clientRole }
  }
  return null
}
