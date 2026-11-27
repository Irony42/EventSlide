import type { ClientLocale } from '../../../domain/clients/clientLocale'
import { AuditEntry } from '../../../domain/audit/auditEntry'
import { signupConfirmLink, signupConfirmationMail } from '../../../domain/mail/signupMails'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import { signupEnabled, type SignupMode } from '../../../domain/signups/signupMode'
import { createSignupRequest } from '../../../domain/signups/signupRequest'
import { ACCOUNT_TOKEN_LIFETIME_MS, issueAccountToken } from '../../../domain/users/accountToken'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { IdGenerator } from '../../ports/idGenerator'
import type { Logger } from '../../ports/logger'
import type { Mailer } from '../../ports/mailer'
import type { SecretTokens } from '../../ports/secretTokens'
import type { SignupRepository } from '../../ports/signupRepository'

export interface RequestSignupInput {
  /** What the person typed. Parsed here, and never echoed back. */
  readonly email: string
  readonly clientName: string
  readonly note?: string
  /** `YYYY-MM-DD`. */
  readonly eventDate?: string
  /** The language of the page; the confirmation mail is written in it. */
  readonly locale: ClientLocale
  /** The honeypot: a person never sees this field, so anything in it is a script. */
  readonly website: string
}

export interface RequestSignupDeps {
  readonly mode: SignupMode
  readonly signups: Pick<SignupRepository, 'admit'>
  readonly secrets: SecretTokens
  readonly mailer: Mailer
  readonly ids: Pick<IdGenerator, 'accountTokenId' | 'signupRequestId'>
  readonly clock: Clock
  readonly logger: Logger
  readonly audit: AuditRecorder
  readonly publicUrl: string
  /** `SIGNUP_MAX_PER_DAY`. */
  readonly maxPerDay: number
}

export interface SignupRequested {
  /** `busy` only when the whole box has reached its confirmations for the day: global state, nothing about an address. */
  readonly status: 'sent' | 'busy'
  /**
   * Resolves when the mail (and the audit line of a reached ceiling) is done. **Never rejects.** The HTTP layer
   * does not wait for it, so the slow part, the relay, cannot tell a caller whether anything was sent.
   */
  readonly completion: Promise<void>
}

export type RequestSignup = (
  input: RequestSignupInput,
) => Promise<Result<SignupRequested, DomainError>>

const done = Promise.resolve()

/**
 * The public signup form (spec 31, ADR 0018). **A request, not an account**: nothing here writes a user, a
 * client or a password.
 *
 * - `404 feature.unavailable` while `SIGNUP=off`. Configuration, never the address.
 * - A field that is wrong is `400` with the domain's code: that depends on what the caller typed, not on
 *   what the box knows.
 * - The **honeypot** answers `sent` and writes nothing.
 * - Everything else is `sent` whatever the address is (new, known, waiting, refused lately, over its caps): the
 *   admission (`SignupRepository.admit`, one write transaction) decides, and the answer never depends on it,
 *   **except** `busy` at the day's ceiling, which is the same for everybody.
 *   The admission is a database write and is awaited, because the ceiling is part of the answer; the part that
 *   is slow and visible, the mail, runs in `completion`.
 * - Nothing the person typed, no token and no link is ever logged.
 */
export const makeRequestSignup = ({
  mode,
  signups,
  secrets,
  mailer,
  ids,
  clock,
  logger,
  audit,
  publicUrl,
  maxPerDay,
}: RequestSignupDeps): RequestSignup => {
  /** The last day (UTC) whose ceiling was written down: once a day, not once a request. */
  let ceilingAuditedOn: string | null = null

  const recordCeiling = async (now: Date): Promise<void> => {
    const day = now.toISOString().slice(0, 10)
    if (ceilingAuditedOn === day) return
    ceilingAuditedOn = day
    const entry = AuditEntry.create({
      at: now,
      actor: { kind: 'system', label: 'signup' },
      action: 'signup.dailyCeilingReached',
      subject: { type: 'access_request', id: day },
      clientId: null,
      details: {},
    })
    if (!entry.ok) {
      logger.error('the daily ceiling could not be recorded', { code: entry.error.code })
      return
    }
    await audit.record(entry.value)
    logger.warn('the daily ceiling of signup confirmations is reached')
  }

  const guarded = (work: () => Promise<void>): Promise<void> =>
    work().catch((error: unknown) => {
      logger.error('a signup request failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })

  return async (input) => {
    if (!signupEnabled(mode)) return err(DomainError.notFound('feature.unavailable'))

    if (input.website.trim() !== '') return ok({ status: 'sent', completion: done })

    const address = EmailAddress.create(input.email)
    if (!address.ok) return address

    const now = clock.now()
    const request = createSignupRequest(
      {
        id: ids.signupRequestId(),
        email: address.value,
        clientName: input.clientName,
        note: input.note,
        eventDate: input.eventDate,
        locale: input.locale,
      },
      now,
    )
    if (!request.ok) return request

    const minted = secrets.mint()
    const token = issueAccountToken(
      {
        purpose: 'emailVerification',
        tokenDigest: minted.digest,
        email: address.value,
        userId: null,
        delivery: 'mail',
        createdBy: null,
      },
      ids.accountTokenId(),
      now,
    )
    if (!token.ok) return token

    const admitted = await signups.admit({
      request: request.value,
      token: token.value,
      now,
      maxPerDay,
    })

    if (admitted.outcome === 'busy') {
      return ok({ status: 'busy', completion: guarded(() => recordCeiling(now)) })
    }
    if (admitted.outcome === 'silent') return ok({ status: 'sent', completion: done })

    const completion = guarded(async () => {
      const sent = await mailer.send(
        signupConfirmationMail({
          to: address.value,
          locale: request.value.locale,
          link: signupConfirmLink(publicUrl, minted.token, request.value.locale),
          lifetimeHours: ACCOUNT_TOKEN_LIFETIME_MS.emailVerification / 3_600_000,
        }),
      )
      if (!sent.ok)
        logger.warn('a signup confirmation mail was not sent', { code: sent.error.code })
      // The ceiling is reached by this very request: written down once, with the day's first refusal or now.
      if (admitted.issuedToday >= maxPerDay) await recordCeiling(now)
    })
    return ok({ status: 'sent', completion })
  }
}
