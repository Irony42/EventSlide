/**
 * When a browser that signed in to an account before is still trusted to have a sign-in
 * throttle bucket of its own (free plan G3-04b, on top of G3-04 / P4-07).
 *
 * The per-account throttle (`signInThrottle.ts`) keys its bucket by the account **and the
 * network** the attempt comes from. A stranger on the owner's own network who knows the address
 * therefore shares the owner's bucket, and one wrong guess every fifteen minutes keeps the owner
 * off it. A device the account has signed in from before is told apart by something the stranger
 * does not hold: a signed cookie set at the last successful sign-in. This file is the rule for
 * when that cookie still counts. The cookie itself, and the HMAC that makes it unforgeable, are
 * the HTTP layer's (`middleware/trustedDevice.ts`); the bucket it selects is `deviceSource` in
 * `signInThrottle.ts`.
 *
 * ## What the cookie is, and is not
 *
 * It is a **key for a throttle bucket** and nothing else. It authenticates nobody, skips no
 * password and no second factor, and opens no session: a request carrying it is checked exactly
 * as any other, and a stolen one buys the thief a bucket that backs off like every other (five
 * free failures, then a doubling wait up to fifteen minutes), shared with the owner, in addition
 * to the one their own network already gave them. The per-client limit and the account-wide hold
 * count its failures like any other's.
 *
 * ## When it stops counting
 *
 * - **Ninety days after its sign-in.** Every successful sign-in issues a new one, so a device
 *   that is used stays trusted, and one that is not stops being.
 * - **From the future.** The server wrote the stamp, so a stamp later than now is a clock that
 *   moved, not a device; the guest token and the session cap read a negative age the same way.
 * - **When the account's credentials change after it was issued** (a password change, a reset,
 *   "sign out everywhere": the credentials epoch of docs/SECURITY.md §2). These are the moments
 *   a person is saying that what was true of their devices is no longer so, and trust that
 *   outlived them would be trust nobody granted. The device falls back to the network bucket,
 *   which is where it stood before this existed, until its next successful sign-in.
 * - **When the account is switched off or gone.**
 *
 * Every one of these is a fall back to the network bucket, never a refusal, and from outside it
 * looks like no cookie at all.
 */

/** How long a device stays trusted after the sign-in that issued its cookie. */
export const TRUSTED_DEVICE_LIFETIME_MS = 90 * 24 * 60 * 60_000

export interface TrustedDeviceFacts {
  /** The instant of the sign-in that issued the cookie, in epoch milliseconds. */
  readonly issuedAtMs: number
  readonly nowMs: number
  /** False for an account that is switched off or does not exist. */
  readonly accountActive: boolean
  /** The account's credentials epoch, or `null` when its credentials never changed. */
  readonly credentialsChangedAtMs: number | null
}

export const isTrustedDevice = ({
  issuedAtMs,
  nowMs,
  accountActive,
  credentialsChangedAtMs,
}: TrustedDeviceFacts): boolean => {
  if (!accountActive) return false
  if (!Number.isFinite(issuedAtMs) || issuedAtMs > nowMs) return false
  if (nowMs - issuedAtMs >= TRUSTED_DEVICE_LIFETIME_MS) return false
  // Not earlier than the epoch, the same comparison `enforceSessionAge` makes: the sign-in that
  // follows a change is stamped at or after it and is trusted again.
  return credentialsChangedAtMs === null || issuedAtMs >= credentialsChangedAtMs
}
