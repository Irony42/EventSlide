/**
 * The cryptography behind a shared gallery link (docs/ROADMAP.md §4.1).
 *
 * A port because `node:crypto` is I/O as far as `src/application` is concerned, and
 * because what the use cases need is small enough to state exactly: a token to hand out,
 * the digest it is stored as, and one keyed MAC.
 *
 * ## One MAC, many statements
 *
 * Everything the gallery signs — a media URL, a password unlock, a page cursor, the
 * album archive — is a list of strings whose **first element names what it is**
 * (`'media'`, `'unlock'`, …). The adapter length-prefixes each part before it MACs the
 * list, so `['ab', 'c']` and `['a', 'bc']` are different statements and no signature
 * minted for one purpose verifies for another. That is the whole reason there is a
 * single `sign` rather than one method per purpose: the domain separation is in the
 * data, where a test can see it, rather than in four near-identical adapter methods.
 *
 * ## What the adapter promises
 *
 * - `mintToken` answers at least 256 bits of entropy, URL-safe, and the digest the token
 *   is stored as. The token itself is never stored and never logged.
 * - `digestOf(token)` is the same digest `mintToken` gave for that token, and nothing
 *   else maps to it. A fast hash is right here: the token is random, not chosen.
 * - `verify` compares in constant time, and answers `false` — never throws — for any
 *   input a caller could send, however malformed.
 * - Every signature is drawn from the base64url alphabet (`A–Z a–z 0–9 - _`) and nothing
 *   else: two of them travel in query strings and one in a cookie, and the unlock proof
 *   and the page cursor join a signature to its payload with a `.` — so a signature
 *   containing one would make both unreadable.
 */

export interface MintedShareToken {
  /** The secret that goes in the URL. Returned once, to the host, and never stored. */
  readonly token: string
  /** What is stored instead, and what a lookup compares. */
  readonly digest: string
}

export interface GallerySigner {
  mintToken(): MintedShareToken
  digestOf(token: string): string
  sign(parts: readonly string[]): string
  verify(parts: readonly string[], signature: string): boolean
}
