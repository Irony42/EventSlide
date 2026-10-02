import { DomainError } from '../shared/errors'
import type { AccountTokenId, EventId, UserId } from '../shared/ids'
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
 * sign in. Only {@link AccountTokenPurpose}`'passwordReset'` is spent by anything yet; the
 * others are here because their columns are (migration 010) and because a rule written once
 * is audited once.
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
 * How the link was meant to reach its owner: `mail`, or `link` — shown on screen to be
 * copied, because the box has no relay. The distinction is part of the record because
 * receiving a link by mail proves control of the mailbox, and being handed one by the person
 * who created it proves nothing of the kind.
 */
export type AccountTokenDelivery = 'mail' | 'link'

/** The only role an invitation can grant inside an event. */
export type AccountTokenEventRole = 'moderator'

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
 * - **A role needs an event.** `eventRole` without `eventId` grants moderation of nothing.
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
  if (eventRole !== null && eventId === null) {
    return err(DomainError.invalid('accountToken.eventRequired'))
  }

  return ok({
    id,
    purpose: input.purpose,
    tokenDigest: input.tokenDigest,
    email: input.email,
    userId: input.userId,
    eventId,
    eventRole,
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
