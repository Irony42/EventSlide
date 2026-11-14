import { createHmac } from 'node:crypto'
import type { StatementSigner } from '../../application/ports/statementSigner'
import { constantTimeEqual, deriveKey } from './primitives'

/**
 * HMAC-SHA256 over length-prefixed parts, under a key derived from a secret the box already holds
 * (ARCH-04: the one implementation behind the shared gallery and the trusted-device cookie).
 *
 * ## The key
 *
 * HKDF-SHA256 of the root secret with an empty salt and a `label` of the caller's own. The label is
 * the domain separation: the same secret under two labels gives two keys that share nothing, so
 * nothing the gallery signs can be replayed as a device cookie, nor either as something
 * `express-session` signs. A new *required* secret would refuse to boot every installation on
 * upgrade, which is why the parent is `SESSION_SECRET` and not a new variable.
 *
 * ## The encoding
 *
 * Each part is `<utf-8 byte length>:<part>` before it is MACed, so no boundary between two parts
 * can be moved and no statement is a prefix of another.
 *
 * Neither the label nor the encoding may ever change for a label in use: every outstanding link
 * and cookie would stop verifying. `hmacStatementSigner.test.ts` pins both with literals.
 */

/** The key of the sign-in throttle's trusted-device cookie (`middleware/trustedDevice.ts`). */
export const TRUSTED_DEVICE_SIGNER_LABEL = 'eventslide/trusted-device/v1'

/** A base64url HMAC-SHA256 is always these 43 characters (and 43 bytes). Anything else is not ours. */
const SIGNATURE_SHAPE = /^[A-Za-z0-9_-]{43}$/

export interface HmacStatementSignerOptions {
  readonly rootSecret: string
  /** The HKDF label: one per purpose, never reused, never changed. */
  readonly label: string
}

const canonical = (parts: readonly string[]): Buffer =>
  Buffer.concat(
    parts.map((part) => {
      const bytes = Buffer.from(part, 'utf8')
      return Buffer.concat([Buffer.from(`${bytes.length}:`, 'utf8'), bytes])
    }),
  )

export const createHmacStatementSigner = ({
  rootSecret,
  label,
}: HmacStatementSignerOptions): StatementSigner => {
  const key = deriveKey(rootSecret, label)

  const sign = (parts: readonly string[]): string =>
    createHmac('sha256', key).update(canonical(parts)).digest('base64url')

  return {
    sign,
    verify: (parts, signature) => {
      // The shape of an HMAC is public, so refusing on it leaks nothing, spares computing a MAC for
      // a value that cannot be one, and keeps anything that is not base64url (a two-byte character
      // among them) from reaching the byte comparison.
      if (!SIGNATURE_SHAPE.test(signature)) return false
      return constantTimeEqual(sign(parts), signature)
    },
  }
}
