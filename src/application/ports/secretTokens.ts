/**
 * The secrets that go in a link: a password-reset token, an invitation, an e-mail
 * verification (docs/ROADMAP.md §10.3).
 *
 * A port because `node:crypto` is I/O as far as `src/application` is concerned, and because
 * what the use cases need is small enough to state exactly: a token to put in the mail, the
 * digest it is stored as, and a way to ask whether a presented token is the one a digest
 * stands for.
 *
 * ## What the adapter promises
 *
 * - `mint` answers at least **256 bits** of entropy, URL-safe, plus the digest the token is
 *   stored as. The token is returned once, to the use case that puts it in a mail, and is
 *   never stored and never logged.
 * - `digestOf(token)` is the digest `mint` gave for that token, as 64 lower-case hex
 *   characters, and nothing else maps to it. A fast hash is right here: the token is random,
 *   not chosen, so there is nothing to brute-force and the lookup stays an index seek.
 * - `verify` compares a presented token with a stored digest **in constant time**, and
 *   answers `false` — never throws — for any input a caller could send, however malformed.
 *
 * ## Why `verify` exists when the lookup already matched
 *
 * The repository finds a token by its digest, so no secret is ever compared character by
 * character in JavaScript, and the lookup leaks nothing that helps an attacker: a digest of
 * an unknown token is useless without its preimage. `verify` is the second line. It is what
 * stops a repository that matched loosely — a `LIKE`, a case-insensitive collation, a fake
 * that returned the wrong row — from turning "something close to a digest" into "a valid
 * token", and it does so without a timing difference an attacker could read.
 */

export interface MintedToken {
  /** The secret that goes in the link. Returned once and never stored. */
  readonly token: string
  /** What is stored instead, and what a lookup compares. */
  readonly digest: string
}

export interface SecretTokens {
  mint(): MintedToken
  digestOf(token: string): string
  verify(token: string, digest: string): boolean
}
