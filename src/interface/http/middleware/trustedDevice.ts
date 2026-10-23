import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { z } from 'zod'
import type { Clock } from '../../../application/ports/clock'
import type { UserRepository } from '../../../application/ports/userRepository'
import { asUserId } from '../../../domain/shared/ids'
import { normalisedAddress } from '../../../domain/users/emailAddress'
import { TRUSTED_DEVICE_LIFETIME_MS, isTrustedDevice } from '../../../domain/users/trustedDevice'

/**
 * The trusted-device cookie of the sign-in throttle (free plan G3-04b, on top of G3-04 / P4-07).
 *
 * The rule for when a device counts is `domain/users/trustedDevice.ts`; the bucket it selects is
 * `deviceSource` in `domain/users/signInThrottle.ts`; the problem it answers is in
 * `docs/SECURITY.md` §5. This file is the cookie: what it holds, how it is signed, and how it is
 * set and read.
 *
 * ## What it holds
 *
 * ```
 * es_device = v1.<base64url(payload)>.<base64url(HMAC-SHA256(key, "v1", payload, address))>
 *
 * payload = { "d": "<random device id>", "u": "<user id>", "i": 1781038800000 }
 * ```
 *
 * - **`d`, an opaque id**: 128 random bits, new at every sign-in. It is the key of the device's
 *   throttle bucket and means nothing else.
 * - **`u`, the account's id**, which is what the credentials epoch is read by. It is an opaque
 *   identifier and not a secret (the session already carries it), and the cookie is `HttpOnly`.
 * - **`i`, when it was issued**: the epoch and the lifetime are measured from it.
 * - **No e-mail address and nothing of the account's credentials**, in the clear or hashed: the
 *   address enters the MAC and not the payload, so the cookie is bound to the account without
 *   saying whose it is, and a reader of the cookie learns nothing it can try against the login.
 *
 * ## Why it cannot be used on another account
 *
 * The normalised address that is being tried is part of what the MAC covers. A cookie issued
 * to `a@x.test` verifies only when the attempt is about `a@x.test`; presented while trying
 * `b@x.test` it is just bytes that do not match, and the attempt is counted in the network
 * bucket as if there were no cookie. (A cookie is bound to the address as it was at the
 * sign-in: if an account's address ever changes, its cookies stop counting, which is the safe
 * direction.)
 *
 * ## The key
 *
 * Derived from `SESSION_SECRET` with HKDF under a label of its own, rather than read from a new
 * variable and rather than used directly, for the reasons `hmacGallerySigner.ts` gives: a new
 * required secret would refuse to boot every existing installation, and the label means nothing
 * `express-session` signs can be replayed as a device cookie or the other way round. Rotating
 * `SESSION_SECRET` ends every device's trust, which is the safe side of that trade: they fall
 * back to the network bucket, and the next successful sign-in sets a new one.
 *
 * ## The attributes
 *
 * - **`HttpOnly`**: no script needs it, and the page has no business reading what it keys.
 * - **`SameSite=Strict`**: it is read by one same-origin `fetch` from the sign-in form and never
 *   by a navigation, so nothing is lost; a request another site makes for the browser (a form
 *   posted from elsewhere) arrives without it and is counted in the network bucket, which is
 *   where an attempt the owner did not make should be counted. `Lax` would add nothing but a
 *   wider set of requests that carry it.
 * - **`Secure`** whenever the site is served over https (`config.secureCookie`, as every cookie
 *   here).
 * - **`Path=/api/auth`**: sent to the routes that sign in, sign out and reset a password, and to
 *   no media or event request. Host-only, no `Domain`.
 * - **`Max-Age` ninety days**, the domain's lifetime, renewed at every successful sign-in. The
 *   server judges the age from the signed stamp and not from the browser's expiry, which a user
 *   can edit.
 *
 * It survives a sign-out on purpose: it says "this browser has signed in to this account",
 * which stays true. It is set only by a successful password sign-in, never by a password change
 * or "sign out everywhere": a session that was merely stolen must not be able to mint a device.
 *
 * One cookie holds one account: signing in to a second account in the same browser replaces
 * the first's, which then falls back to the network bucket. A degradation, never a lockout.
 *
 * ## What reading it never reveals
 *
 * A cookie that is missing, malformed, forged, signed with another key, issued for another
 * address, expired, from the future, or belonging to an account whose credentials changed since
 * is **the same outcome**: `undefined`, with nothing to tell it from the rest. The one read it
 * costs is the account's state, and it is made only for a cookie whose signature is valid for
 * this address, which nobody can produce without a successful sign-in.
 */

export const TRUSTED_DEVICE_COOKIE = 'es_device'

const COOKIE_PATH = '/api/auth'
const VERSION = 'v1'
const LABEL = 'eventslide/trusted-device/v1'
const KEY_BYTES = 32
const DEVICE_ID_BYTES = 16

/**
 * A base64url HMAC-SHA256 is always these 43 characters, which are also 43 bytes. Checked as a
 * shape and not as a length: `timingSafeEqual` throws when its two inputs differ in **bytes**,
 * and a cookie made of 43 two-byte characters has the right length in characters. The throw
 * would be a 500 for a forged cookie where no cookie gets a 401.
 */
const MAC_SHAPE = /^[A-Za-z0-9_-]{43}$/

const claims = z
  .object({
    d: z.string().min(1).max(64),
    u: z.string().min(1).max(64),
    i: z.number().int().nonnegative(),
  })
  .strict()

export interface DeviceClaims {
  readonly device: string
  readonly userId: string
  readonly issuedAtMs: number
}

/** Length-prefixed, so no boundary between two parts can be moved. */
const canonical = (parts: readonly string[]): Buffer =>
  Buffer.concat(
    parts.map((part) => {
      const bytes = Buffer.from(part, 'utf8')
      return Buffer.concat([Buffer.from(`${bytes.length}:`, 'utf8'), bytes])
    }),
  )

/** The signing and the checking, with no Express and no clock in them. */
export const trustedDeviceCodec = (secret: string) => {
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), LABEL, KEY_BYTES))

  const macOf = (payload: string, address: string): string =>
    createHmac('sha256', key)
      .update(canonical([VERSION, payload, address]))
      .digest('base64url')

  return {
    /** The cookie value for `claimed`, bound to `address`. */
    seal(claimed: DeviceClaims, address: string): string {
      const payload = Buffer.from(
        JSON.stringify({ d: claimed.device, u: claimed.userId, i: claimed.issuedAtMs }),
        'utf8',
      ).toString('base64url')
      return `${VERSION}.${payload}.${macOf(payload, address)}`
    },

    /**
     * The claims in `value`, or `undefined` for anything that is not a cookie this key signed
     * for `address`. The MAC is compared **before** the payload is decoded: bytes an attacker
     * forged never reach the JSON parser.
     */
    open(value: unknown, address: string): DeviceClaims | undefined {
      // `cookie-parser` hands back an object for a value that starts `j:`, so this is not
      // always a string.
      if (typeof value !== 'string') return undefined
      const parts = value.split('.')
      const [version, payload, mac] = parts
      if (parts.length !== 3 || version !== VERSION || payload === undefined || mac === undefined) {
        return undefined
      }
      if (!MAC_SHAPE.test(mac)) return undefined
      const expected = Buffer.from(macOf(payload, address), 'utf8')
      const presented = Buffer.from(mac, 'utf8')
      if (!timingSafeEqual(new Uint8Array(expected), new Uint8Array(presented))) return undefined

      let decoded: unknown
      try {
        decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      } catch {
        return undefined
      }
      const parsed = claims.safeParse(decoded)
      if (!parsed.success) return undefined
      return { device: parsed.data.d, userId: parsed.data.u, issuedAtMs: parsed.data.i }
    },
  }
}

export interface TrustedDevices {
  /**
   * The id of the trusted device this request comes from, when it presents a valid cookie for
   * `address`, the account is still switched on and its credentials have not changed since;
   * `undefined` in every other case, all of which are one outcome.
   */
  recognise(req: Request, address: string): Promise<string | undefined>

  /** Sets (or renews) the cookie for an account that has just signed in. */
  remember(res: Response, who: { readonly userId: string; readonly email: string }): void
}

export interface TrustedDevicesOptions {
  /** `SESSION_SECRET`: the parent of the key the cookie is signed with. */
  readonly secret: string
  readonly clock: Clock
  /** The one read the epoch needs. */
  readonly users: Pick<UserRepository, 'authStateFor'>
  /** `config.secureCookie`: whether the site is served over https. */
  readonly secureCookie: boolean
}

export const trustedDevices = ({
  secret,
  clock,
  users,
  secureCookie,
}: TrustedDevicesOptions): TrustedDevices => {
  const codec = trustedDeviceCodec(secret)

  return {
    async recognise(req, address) {
      const value: unknown = req.cookies?.[TRUSTED_DEVICE_COOKIE]
      const opened = codec.open(value, normalisedAddress(address))
      if (opened === undefined) return undefined

      const state = await users.authStateFor(asUserId(opened.userId))
      const trusted = isTrustedDevice({
        issuedAtMs: opened.issuedAtMs,
        nowMs: clock.now().getTime(),
        accountActive: state.active,
        credentialsChangedAtMs: state.credentialsChangedAt?.getTime() ?? null,
      })
      return trusted ? opened.device : undefined
    },

    remember(res, who) {
      const value = codec.seal(
        {
          device: randomBytes(DEVICE_ID_BYTES).toString('base64url'),
          userId: who.userId,
          issuedAtMs: clock.now().getTime(),
        },
        normalisedAddress(who.email),
      )
      res.cookie(TRUSTED_DEVICE_COOKIE, value, {
        httpOnly: true,
        sameSite: 'strict',
        secure: secureCookie,
        path: COOKIE_PATH,
        maxAge: TRUSTED_DEVICE_LIFETIME_MS,
      })
    },
  }
}
