import { createHmac } from 'node:crypto'
import type { TotpEngine } from '../../application/ports/totpEngine'
import { TOTP_DIGITS } from '../../domain/users/totp'

/**
 * `TotpEngine` over `node:crypto`: RFC 6238 on top of RFC 4226, HMAC-SHA1.
 *
 * Implemented here rather than taken from a package because it is thirty lines, and because
 * a dependency that decides who may operate the box is a dependency whose every release has
 * to be read. The two RFCs publish their own test vectors and `nodeTotpEngine.test.ts` runs
 * every one of them: RFC 4226 Appendix D for the counter, RFC 6238 Appendix B for the clock.
 *
 * SHA-1 is the algorithm every authenticator app implements by default, and HMAC-SHA1 is not
 * affected by the collision attacks on the bare hash; the code is also only six digits, valid
 * for thirty seconds, and spent on first use, so the primitive is not the weak point of this
 * design.
 */

const COUNTER_BYTES = 8

/** RFC 4226 section 5.3, dynamic truncation: four bytes at an offset the last nibble names. */
const truncate = (mac: Uint8Array): number => {
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f
  return (
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    (((mac[offset + 1] ?? 0) & 0xff) << 16) |
    (((mac[offset + 2] ?? 0) & 0xff) << 8) |
    ((mac[offset + 3] ?? 0) & 0xff)
  )
}

/**
 * HOTP (RFC 4226): the `digits`-digit code for `counter`.
 *
 * Exported for the test that runs the RFC 6238 vectors, which are eight digits long — the
 * product itself only ever asks for {@link TOTP_DIGITS}.
 */
export const hotp = (key: Uint8Array, counter: number, digits: number): string => {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new RangeError('a TOTP step is a non-negative safe integer')
  }
  const message = Buffer.alloc(COUNTER_BYTES)
  message.writeBigUInt64BE(BigInt(counter))

  const mac = createHmac('sha1', key).update(message).digest()
  return String(truncate(mac) % 10 ** digits).padStart(digits, '0')
}

export const nodeTotpEngine: TotpEngine = {
  codeAt: (secret, step) => hotp(secret, step, TOTP_DIGITS),
}
