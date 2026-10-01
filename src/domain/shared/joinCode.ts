import { DomainError } from './errors'
import { err, ok, type Result } from './result'

/**
 * The code a guest types or scans to join an event: `H7K2QM`.
 *
 * Design constraints, in order of importance:
 *
 * 1. **A guest reads it off a printed card in a dark room and types it on a phone.**
 *    So the alphabet excludes `I`, `L`, `O` and `U`: `I`/`l`/`1` and `O`/`0` are
 *    indistinguishable in most fonts, and dropping `U` removes most accidental
 *    obscenities. That is Crockford's base32 alphabet, and its normalisation rules
 *    (`I`/`L` → `1`, `O` → `0`) are applied on input so a mistyped code still resolves.
 * 2. **It is a bearer credential.** 32^6 ≈ 1.07 × 10⁹ codes for the default length, and
 *    a deployment may configure a longer one — `JOIN_CODE_LENGTH`, 6 to 10 — for more.
 *    Combined with the per-IP rate limit on the join endpoint, guessing an active code
 *    is not a practical attack. It is not a secret against someone who photographs the
 *    card — it is not meant to be; see docs/SECURITY.md on accepted risks.
 * 3. **It is rotatable.** A host who finds the link circulating outside the venue
 *    rotates the code and the old one stops working immediately.
 *
 * Randomness lives in the `IdGenerator` port. This module only maps bytes to
 * characters, which keeps code generation deterministic under test.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * 2.0's only length, and still what a box that never sets `JOIN_CODE_LENGTH` gets —
 * every code already printed on a card is this long, and the lower bound of the
 * configurable range is written as this constant rather than restated so the two can
 * never drift apart.
 */
const MIN_LENGTH = 6

/**
 * The upper end of the configurable range (P4-09 / D-14). Wide enough that a hosted
 * instance can ask for meaningfully more entropy than the default without turning the
 * code into something nobody will retype from a printed card.
 */
const MAX_LENGTH = 10

/** `I` and `L` are read as `1`, `O` as `0`; separators are noise. */
const CONFUSABLES: Readonly<Record<string, string>> = { I: '1', L: '1', O: '0' }

/**
 * Fold what a guest actually typed into canonical form: uppercase, separators removed,
 * confusable characters mapped. `h7k2-qm`, `H7K2 QM` and `h7kzqm` with a typed `O`
 * for `0` all reach the same code.
 */
export const normaliseJoinCode = (raw: string): string =>
  raw
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .split('')
    .map((character) => CONFUSABLES[character] ?? character)
    .join('')

export class JoinCode {
  private constructor(readonly value: string) {}

  static create(raw: unknown): Result<JoinCode, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('joinCode.invalid'))
    const candidate = normaliseJoinCode(raw)

    if (candidate.length < MIN_LENGTH || candidate.length > MAX_LENGTH) {
      return err(DomainError.invalid('joinCode.wrongLength', { min: MIN_LENGTH, max: MAX_LENGTH }))
    }
    for (const character of candidate) {
      if (!ALPHABET.includes(character)) {
        return err(DomainError.invalid('joinCode.malformed'))
      }
    }
    return ok(new JoinCode(candidate))
  }

  /**
   * Deterministically map random bytes to a code of the given length.
   *
   * 256 is an exact multiple of 32, so `byte % 32` is uniform — no modulo bias, and
   * no rejection sampling needed. Requires exactly `length` bytes so a caller cannot
   * accidentally derive a code from too little entropy, and `length` itself is not
   * re-bounded here: {@link JoinCode.create} is the single place that enforces
   * {@link JoinCode.minLength} to {@link JoinCode.maxLength}, so a caller configured
   * with an out-of-range `JOIN_CODE_LENGTH` meets the same refusal env validation
   * already stops at the door.
   *
   * `length` defaults to {@link JoinCode.minLength} — 2.0's only length, and what every
   * call site that has not been handed a configured `JOIN_CODE_LENGTH` still gets.
   */
  static fromBytes(
    bytes: Readonly<Uint8Array>,
    length: number = MIN_LENGTH,
  ): Result<JoinCode, DomainError> {
    if (bytes.length !== length) {
      return err(DomainError.invalid('joinCode.wrongEntropyLength', { length }))
    }
    let value = ''
    for (const byte of bytes) {
      // Safe: the modulo is always within the alphabet, which is why this is not a
      // `noUncheckedIndexedAccess` hazard in practice — but the fallback keeps the
      // types honest without an assertion.
      value += ALPHABET[byte % ALPHABET.length] ?? ALPHABET[0]
    }
    return JoinCode.create(value)
  }

  static readonly alphabet = ALPHABET
  /** The floor of the configurable range, and the length every pre-existing code is. */
  static readonly minLength = MIN_LENGTH
  /** The ceiling of the configurable range (`JOIN_CODE_LENGTH`). */
  static readonly maxLength = MAX_LENGTH

  equals(other: JoinCode): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
