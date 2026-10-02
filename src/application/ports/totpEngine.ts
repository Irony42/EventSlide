/**
 * The one piece of RFC 6238 that needs a cryptographic primitive: the code a secret yields
 * for a step.
 *
 * A port because `node:crypto` is I/O as far as `src/application` is concerned. Everything
 * *around* the HMAC — which steps to try, how a replay is refused, how the secret is
 * written for an authenticator — is domain code (`domain/users/totp.ts`), so what the adapter
 * promises is small enough to state exactly and to test against the vectors in RFC 6238
 * Appendix B.
 *
 * ## What the adapter promises
 *
 * - HMAC-SHA1 over the step as an 8-byte big-endian counter, dynamically truncated
 *   (RFC 4226 section 5.3), reduced to `TOTP_DIGITS` decimal digits and zero-padded on the
 *   left. Nothing else: no window, no clock, no replay rule.
 * - Pure and deterministic: the same secret and step give the same code. It reads no clock,
 *   so a test drives it with any step it likes.
 */
export interface TotpEngine {
  codeAt(secret: Uint8Array, step: number): string
}
