import { DomainError } from './errors'
import { err, ok, type Result } from './result'

/**
 * A URL-safe event identifier chosen by the host: `camille-et-sacha`.
 *
 * The slug appears in every link a guest or a projector uses, so it is normalised once
 * on creation and stored already-normalised. That keeps the unique index usable
 * (no `COLLATE NOCASE`) and means two hosts cannot create `Mariage` and `mariage` and
 * then wonder which one the QR code points at.
 */

const MIN_LENGTH = 2
const MAX_LENGTH = 64

/**
 * Words that would collide with an application route. `/e/:slug` keeps event slugs out
 * of the top-level namespace, but the host also sees the slug in the admin URL, and a
 * slug called `new` or `settings` reads as a bug even when it resolves correctly.
 */
const RESERVED = new Set([
  'admin',
  'api',
  'assets',
  'display',
  'e',
  'edit',
  'events',
  'favicon',
  'health',
  'join',
  'login',
  'logout',
  'manifest',
  'media',
  'moderation',
  'new',
  'null',
  'photos',
  'public',
  'settings',
  'static',
  'undefined',
  'upload',
])

/**
 * Fold a human title into slug shape.
 *
 * Exported because the host-facing UI previews the slug while they type the event
 * name, and that preview must be produced by exactly this function — a second
 * implementation in the frontend is how "the slug I saw is not the slug I got"
 * happens.
 *
 * `maxLength` defaults to {@link Slug.maxLength}. A caller that is about to append a
 * random suffix (`EVENT_SLUG_SUFFIX=random`, see {@link Slug.fromNameWithRandomSuffix})
 * passes a smaller bound instead, so a long name is truncated to make room for the
 * suffix rather than truncated into it.
 */
export const slugify = (raw: string, maxLength: number = MAX_LENGTH): string =>
  raw
    .normalize('NFD')
    // Strip the combining marks NFD just separated: "Camille & Sacha à Lyon" keeps its
    // letters, loses its accents, so the URL survives copy-paste through any client.
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')

/**
 * Whether — and how — a derived slug is given a random suffix (roadmap, P4-09 / D-14).
 *
 * `'none'` is the core default: `EVENT_SLUG_SUFFIX` unset or absent reproduces 2.0's
 * only behaviour exactly, a bare derived slug. `'random'` is what the hosted instance
 * sets from its first beta boot — see {@link Slug.fromNameWithRandomSuffix} for why a
 * suffix is always appended rather than only on collision.
 */
export type SlugSuffixMode = 'none' | 'random'

/**
 * The lowercase Crockford alphabet `JoinCode` uses, lowercased: `Slug.create`'s own
 * regex admits only `[a-z0-9-]`, so a suffix drawn from the uppercase alphabet would be
 * rejected by the very value object it is building. Lowercasing keeps the suffix in the
 * same unambiguous family — no `i`, `l`, `o` or `u` — while staying slug-shaped.
 */
const SUFFIX_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

/**
 * Six characters: the same width as a default-length `JoinCode`, and for the same
 * reason — 32^6 ≈ 1.07 × 10⁹ combinations is already far more than a collision ever
 * needs to be found in.
 */
const SUFFIX_LENGTH = 6

/** `-` plus the suffix: how much room {@link slugify} must leave for it. */
const SUFFIX_WIDTH = SUFFIX_LENGTH + 1

export class Slug {
  private constructor(readonly value: string) {}

  /** Parse an already-slug-shaped string. Rejects anything it would have to change. */
  static create(raw: unknown): Result<Slug, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('slug.invalid'))
    const candidate = raw.trim()

    if (candidate.length < MIN_LENGTH) {
      return err(DomainError.invalid('slug.tooShort', { min: MIN_LENGTH }))
    }
    if (candidate.length > MAX_LENGTH) {
      return err(DomainError.invalid('slug.tooLong', { max: MAX_LENGTH }))
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate)) {
      return err(DomainError.invalid('slug.malformed'))
    }
    if (RESERVED.has(candidate)) {
      return err(DomainError.invalid('slug.reserved', { slug: candidate }))
    }
    return ok(new Slug(candidate))
  }

  /** Fold a free-text event name into a slug, then validate the result. */
  static fromName(name: string): Result<Slug, DomainError> {
    return Slug.create(slugify(name))
  }

  /**
   * Fold a free-text event name into a slug and **always** append a random suffix:
   * `camille-sacha-h7k2qm`.
   *
   * **Always**, not only on collision. A sequential fallback — `camille-sacha`, then
   * `camille-sacha-2` the first time that collides — was draft 3's mistake: the bare
   * slug a guest never sees is still live, so finding `camille-sacha-2` taken proves
   * `camille-sacha` exists, which is exactly the enumeration oracle `EVENT_SLUG_SUFFIX`
   * exists to close (docs/SECURITY.md, R-08 / A-16 / A-42). Appending the same shape of
   * suffix every time — collision or not — means two events named "Mariage" are
   * `mariage-h7k2qm` and `mariage-9f3wzq` and neither slug implies the other exists.
   *
   * Randomness lives in the `IdGenerator` port, exactly as `JoinCode.fromBytes` takes
   * its bytes rather than calling `Math.random()` itself — this keeps suffix generation
   * deterministic under test and out of domain code that must not touch the clock or a
   * random source directly.
   */
  static fromNameWithRandomSuffix(
    name: string,
    bytes: Readonly<Uint8Array>,
  ): Result<Slug, DomainError> {
    if (bytes.length !== SUFFIX_LENGTH) {
      return err(DomainError.invalid('slug.suffixWrongEntropyLength', { length: SUFFIX_LENGTH }))
    }

    let suffix = ''
    for (const byte of bytes) {
      // Safe, exactly as `JoinCode.fromBytes`'s own fallback is: the modulo is always
      // within the alphabet, and the fallback keeps the types honest without an
      // assertion rather than guarding against a case that cannot occur.
      suffix += SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length] ?? SUFFIX_ALPHABET[0]
    }

    // Reserve room so a 64-character name is truncated to make space for `-h7k2qm`
    // rather than truncated into the middle of it.
    const base = slugify(name, MAX_LENGTH - SUFFIX_WIDTH)
    return Slug.create(`${base}-${suffix}`)
  }

  static isReserved(candidate: string): boolean {
    return RESERVED.has(candidate)
  }

  static readonly minLength = MIN_LENGTH
  static readonly maxLength = MAX_LENGTH
  /** Bytes the `IdGenerator` port must supply to {@link Slug.fromNameWithRandomSuffix}. */
  static readonly suffixEntropyBytes = SUFFIX_LENGTH

  equals(other: Slug): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
