/**
 * The terms of use an invitation's acceptance carries (roadmap G2-20; paid plan P6-07 will
 * reuse it before its own `terms_acceptances` table).
 *
 * **The rule is the operator's, and it is switched on by two settings together**:
 * `LEGAL_TERMS_URL`, the page the person is asked to read, and `LEGAL_TERMS_VERSION`, the
 * short name of the text on that page *as it was when they accepted it* (`2027-01`). Either
 * alone is not a rule: a URL with no version is a link in a footer (G2-17), and a version
 * with no page to read is a promise nobody can keep, which the boot refuses. A box that sets
 * neither asks nothing of anybody, which is every self-hosted box.
 */

/**
 * The version of the terms, as the audit log records it and as `LEGAL_TERMS_VERSION` is
 * written: short, with an alphabet of letters, digits, dots, underscores and hyphens, which
 * is what a date (`2027-01`), a number (`3`) or a tag (`v2.1`) is made of.
 *
 * **Narrow on purpose.** It is written into an audit row that the client's own owner reads
 * (G2-16), and the audit vocabulary has no free-text kind: a sentence, an address and a
 * token (43 characters) do not fit here. It is also never taken from a request. It is read
 * from the box's configuration and nowhere else, so the only person who can write one is the
 * operator, at boot.
 */
export const TERMS_VERSION_MAX_LENGTH = 32

const TERMS_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const isTermsVersion = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= TERMS_VERSION_MAX_LENGTH &&
  TERMS_VERSION_PATTERN.test(value)

/**
 * The terms an acceptance is asked to agree to: where to read them and which version this
 * box is on. `null` wherever it is handed around means "this box asks nothing".
 */
export interface TermsOfUse {
  /** `LEGAL_TERMS_URL`: an https address, or a path on this site. */
  readonly url: string
  /** `LEGAL_TERMS_VERSION`. Always an {@link isTermsVersion}. */
  readonly version: string
}
