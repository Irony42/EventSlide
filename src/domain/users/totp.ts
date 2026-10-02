import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import { encodeBase32 } from './base32'

/**
 * The rules of a time-based one-time password (RFC 6238), without the cryptography.
 *
 * The HMAC is the one thing here that needs `node:crypto`, so it sits behind the
 * `TotpEngine` port and every rule that *uses* its answer is in this file, where it is a
 * function call to test: which steps are acceptable, how a presented code is judged against
 * them, and how a step already spent is refused. The parameters are the ones every
 * authenticator app implements without being asked — HMAC-SHA1, thirty seconds, six digits —
 * and they are constants, not configuration, because a different value would silently stop
 * matching the app on the operator's phone.
 *
 * ## The acceptance rule, in one place
 *
 * A code is accepted when it equals the code of **a step within one step of now**
 * ({@link TOTP_WINDOW_STEPS}: a phone whose clock is half a minute out still works), **and**
 * that step is strictly later than the last one this account used. The second half is the
 * replay refusal, and it is stated in terms of the *matched* step and not of the current
 * one: a code typed at the very end of its step is still the same code a second later, and
 * what must be refused is that code, not "whatever the wall clock says".
 */

export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6

/** Steps either side of the current one that are still accepted: a clock drifting by ±30 s. */
export const TOTP_WINDOW_STEPS = 1

/** 160 bits, the length RFC 4226 recommends for an HMAC-SHA1 key. */
export const TOTP_SECRET_BYTES = 20

/** The step a moment falls in: whole periods since the Unix epoch (RFC 6238, T0 = 0). */
export const totpStepAt = (at: Date): number =>
  Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS)

/** Every step a code presented now may belong to, oldest first. */
export const acceptableTotpSteps = (at: Date): readonly number[] => {
  const current = totpStepAt(at)
  const steps: number[] = []
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset += 1) {
    steps.push(current + offset)
  }
  return steps
}

/**
 * A code as a person types it: six digits, with or without the space an app prints in the
 * middle. Anything else is refused before it costs an HMAC.
 */
export const parseTotpCode = (input: string): Result<string, DomainError> => {
  const compact = input.replace(/\s+/g, '')
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(compact)
    ? ok(compact)
    : err(DomainError.invalid('auth.totpCodeInvalid'))
}

/**
 * Compares two strings of the same length without stopping at the first difference.
 *
 * A six-digit code is not a high-entropy secret, but a comparison that returns early still
 * tells a patient attacker how many leading digits were right, and a step later it is free
 * to avoid. Different lengths are simply different.
 */
const sameCode = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

export interface TotpMatchInput {
  /** What the person typed, already through {@link parseTotpCode}. */
  readonly presented: string
  readonly at: Date
  /** The last step this account was accepted for, or `null` if none. */
  readonly lastUsedStep: number | null
  /** The code the account's secret yields for a step: the `TotpEngine`, bound to the secret. */
  readonly codeAt: (step: number) => string
}

/**
 * The step a presented code was generated for, or `null` when it matches none that may be
 * used now.
 *
 * Every acceptable step is computed and compared, whether or not an earlier one matched, so
 * how long the answer takes does not depend on which step the code was for. A step at or
 * before `lastUsedStep` is skipped *after* its code is computed for the same reason: the
 * refusal of a replay costs what the acceptance of a fresh code does.
 */
export const matchTotpStep = ({
  presented,
  at,
  lastUsedStep,
  codeAt,
}: TotpMatchInput): number | null => {
  let matched: number | null = null
  for (const step of acceptableTotpSteps(at)) {
    const equal = sameCode(presented, codeAt(step))
    const spent = lastUsedStep !== null && step <= lastUsedStep
    if (equal && !spent && matched === null) matched = step
  }
  return matched
}

/**
 * The secret as an authenticator app is given it: the base32 text, without padding.
 * Exported so the enrolment response and the `otpauth://` URI cannot disagree about it.
 */
export const totpSecretText = (secret: Uint8Array): string => encodeBase32(secret)

export interface OtpauthInput {
  /** Who the code is for, shown above the digits: the sign-in address. */
  readonly account: string
  /** Which service it is for. A colon is the label's separator, so one is not allowed in it. */
  readonly issuer: string
  readonly secret: Uint8Array
}

/**
 * The `otpauth://` URI a QR code carries (Google Authenticator's key-URI format).
 *
 * The parameters other than the secret are written out even though they are the defaults,
 * because an app that ignored the omission would choose a different period or length than
 * the server checks, and the first symptom would be a code that never works.
 */
export const otpauthUri = ({ account, issuer, secret }: OtpauthInput): string => {
  const cleanIssuer = issuer.replace(/:/g, ' ').trim()
  const label = `${encodeURIComponent(cleanIssuer)}:${encodeURIComponent(account)}`
  const query = [
    `secret=${totpSecretText(secret)}`,
    `issuer=${encodeURIComponent(cleanIssuer)}`,
    'algorithm=SHA1',
    `digits=${TOTP_DIGITS}`,
    `period=${TOTP_PERIOD_SECONDS}`,
  ].join('&')
  return `otpauth://totp/${label}?${query}`
}
