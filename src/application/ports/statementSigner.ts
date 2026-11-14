/**
 * A keyed MAC over a list of strings: the one signing construction of the box (ARCH-04).
 *
 * The gallery signs media URLs, unlock proofs and page cursors with it, and the sign-in
 * throttle's trusted-device cookie is signed with it too, each under a key of its own. Both
 * used to carry their own copy of the length-prefixed encoding and of the key derivation,
 * because the HTTP layer may not import the adapter; a copy is where a property goes missing.
 *
 * ## One MAC, many statements
 *
 * A statement is a list of strings whose **first element names what it is** (`'media'`,
 * `'unlock'`, `'v1'`, …). The adapter length-prefixes each part before it MACs the list, so
 * `['ab', 'c']` and `['a', 'bc']` are different statements and no signature minted for one
 * purpose verifies for another.
 *
 * ## What the adapter promises
 *
 * - The same key and the same parts always give the same signature, byte for byte: a link or a
 *   cookie issued before an upgrade must still verify after it.
 * - `verify` compares in constant time, and answers `false` (never throws) for any input a
 *   caller could send, however malformed.
 * - Every signature is drawn from the base64url alphabet (`A-Z a-z 0-9 - _`) and nothing else:
 *   they travel in query strings and cookies, and a `.` joins a signature to its payload.
 */
export interface StatementSigner {
  sign(parts: readonly string[]): string
  verify(parts: readonly string[], signature: string): boolean
}
