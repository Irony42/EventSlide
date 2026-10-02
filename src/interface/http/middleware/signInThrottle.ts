import { createHmac } from 'node:crypto'
import type { RequestHandler } from 'express'
import type { Clock } from '../../../application/ports/clock'
import type { Logger } from '../../../application/ports/logger'
import { DomainError } from '../../../domain/shared/errors'
import { SignInThrottle, deviceSource, networkSource } from '../../../domain/users/signInThrottle'
import { sendError } from '../presenters/send'
import { asyncHandler } from './asyncHandler'
import { clientKey } from './rateLimit'
import { normalisedAddress, type TrustedDevices } from './trustedDevice'

/**
 * The per-account half of the sign-in limit (free plan G3-04, paid plan P4-07).
 *
 * `loginLimiter` beside it counts requests per **client** and stays exactly as it was. This
 * counts attempts per **account**, with the rules and their argument in
 * `domain/users/signInThrottle.ts`: five free failures per account and network, then a wait
 * that doubles up to fifteen minutes; a two-second hold, never a refusal, once an account has
 * taken a hundred failures in an hour from everywhere. **There is no lockout**, and the
 * reason is who can reach what: a stranger who knows an owner's address can fill their own
 * network's bucket, and no other.
 *
 * Mounted ahead of the handler and behind the client limit, so a request the client limit
 * refuses never reaches it.
 *
 * ## What it does and does not learn
 *
 * - **The address is read with the handler's own schema** (`addressOf`), so the throttle and
 *   the use case cannot disagree about which requests carry one. A body the handler will
 *   refuse as malformed has no address here either, never reaches a password comparison, and
 *   is not counted.
 * - **It never sees the outcome of the lookup.** A failure is a `401` on the way out, so an
 *   address that is an account, one that is not, a disabled account and a malformed address
 *   spend the same budget and are refused with the same `429` after the same number of
 *   tries. The throttle cannot be used to ask which addresses exist, because nothing it does
 *   depends on the answer.
 * - **The address is keyed, not stored.** The key is an HMAC of the normalised address (the
 *   same normalisation the lookup uses, so `Camille@Example.test ` and `camille@example.test`
 *   are one budget and not two), under the session secret. A heap dump holds digests.
 *
 * ## A trusted device (G3-04b)
 *
 * When `devices` is given and the request presents a valid trusted-device cookie for the
 * address being tried, the attempt is counted under that **device** instead of under the
 * client's network: a bucket of its own, per account and device, with the same arithmetic. A
 * stranger on the owner's own network spends the network's bucket and no longer delays the
 * owner's browser. Everything else is unchanged and applies to both: the per-client limit is
 * mounted ahead of this, the account-wide hold counts every failure, and a cookie that is
 * forged, expired, for another account or revoked by a change of credentials is just not there.
 * The throttle never learns which of those it was.
 *
 * ## `counts`
 *
 * - `'failures'` (sign-in): an attempt is reserved when it starts and **given back** unless it
 *   ends `401`. A `200` also clears the network's wait. A malformed request, a `500` after a
 *   right password and a refusal by someone else's limiter are not wrong guesses.
 * - `'every'` (asking for a reset link): the answer is the same `202` for everyone, so there
 *   is no failure to count and every request spends. It sits ahead of the per-address cap on
 *   mails inside the use case and does not replace it: a throttled request is never mailed
 *   and never counts toward that cap.
 */

export interface SignInThrottleOptions {
  /**
   * The address a request is about, parsed with the schema the handler parses with, or
   * `undefined` when that schema would refuse the body.
   */
  readonly addressOf: (body: unknown) => string | undefined
  readonly counts: 'failures' | 'every'
  /** The one line logged when an account starts being held, without the address in it. */
  readonly alert: string
  readonly clock: Clock
  readonly logger: Logger
  /** `SESSION_SECRET`: the key of the digest an address is tracked under. */
  readonly secret: string
  /** Waits `ms` before the request goes on. A seam for tests; timers by default. */
  readonly hold?: (ms: number) => Promise<void>
  /**
   * Which requests come from a device the account trusts. Omitted, every request is counted
   * under its network, as before: a route that has no sign-in to remember a device from (asking
   * for a reset link) leaves it out.
   */
  readonly devices?: Pick<TrustedDevices, 'recognise'>
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The status a wrong password answers with: the one outcome that stays counted. */
const WRONG_GUESS_STATUS = 401

/**
 * The digest an address is tracked under.
 *
 * Normalised exactly as the lookup normalises it, so that whatever reaches the same account
 * shares a budget. What is not an address at all (it can never match an account) is keyed by
 * its trimmed, lower-cased text, so a stranger typing nonsense is throttled like anyone else
 * rather than being a way to spend nothing.
 */
const accountDigest = (secret: string, raw: string): string =>
  createHmac('sha256', secret)
    .update(`sign-in-throttle:${normalisedAddress(raw)}`)
    .digest('hex')

export const signInThrottle = ({
  addressOf,
  counts,
  alert,
  clock,
  logger,
  secret,
  hold = wait,
  devices,
}: SignInThrottleOptions): RequestHandler => {
  // One table per route, built once: a failed sign-in must not spend the allowance for asking
  // for a reset link, the same reason `passwordResetLimiter` is one limiter per route.
  const ledger = new SignInThrottle()

  return asyncHandler(async (req, res, next) => {
    const address = addressOf(req.body)
    if (address === undefined) {
      next()
      return
    }

    const account = accountDigest(secret, address)
    // A trusted device is counted as itself; everyone else, by where they are. Decided once,
    // before the attempt is reserved, and the same source settles it below.
    const device = devices === undefined ? undefined : await devices.recognise(req, address)
    const source = device === undefined ? networkSource(clientKey(req)) : deviceSource(device)
    const admission = ledger.begin(account, source, clock.now().getTime())

    if (admission.kind === 'wait') {
      // The same code and the same status as the per-client limit: this reveals neither which
      // bucket spoke nor whether the account exists, and `Retry-After` is the only addition.
      sendError(
        res,
        DomainError.rateLimited('rate.limited', {
          retryAfterSeconds: admission.retryAfterSeconds,
        }),
      )
      return
    }

    if (admission.credentialStuffing) {
      // The digest's first characters, not the address: enough to tell one account's alert
      // from another's, and the operator can compute the same HMAC to find out whose.
      logger.warn(alert, { account: account.slice(0, 12) })
    }

    if (counts === 'failures') {
      res.once('finish', () => {
        if (res.statusCode === WRONG_GUESS_STATUS) return
        if (res.statusCode >= 200 && res.statusCode < 300) ledger.succeeded(account, source)
        else ledger.refund(account, source)
      })
    }

    if (admission.holdMs > 0) {
      await hold(admission.holdMs)
      // The caller may have given up while it was held; the attempt stays counted.
      if (res.destroyed) return
    }
    next()
  })
}
