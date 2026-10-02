import type { TotpEngine } from '../ports/totpEngine'
import { TOTP_DIGITS } from '../../domain/users/totp'

/**
 * A `TotpEngine` a ring-2 test can drive without HMAC: a code is a hash of the secret's bytes
 * and the step, reduced to six digits.
 *
 * **Not RFC 6238**, and it does not pretend to be: `nodeTotpEngine.test.ts` holds the real
 * adapter to the published vectors. What this keeps is the contract
 * (`contracts/totpEngineContract.ts` runs the same cases against both), which is all a use
 * case relies on — and which makes a test readable, since `engine.codeAt(secret, step)` names
 * the code a person would type without a test knowing how it is computed.
 */
export class FakeTotpEngine implements TotpEngine {
  codeAt(secret: Uint8Array, step: number): string {
    let hash = 0x811c9dc5
    for (const byte of secret) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
    for (const byte of String(step)) hash = Math.imul(hash ^ byte.charCodeAt(0), 0x01000193) >>> 0
    // A second round of mixing, so neighbouring steps do not differ only in their last digit.
    hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d) >>> 0
    return String(hash % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
  }
}
