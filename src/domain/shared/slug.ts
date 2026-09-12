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
 */
export const slugify = (raw: string): string =>
  raw
    .normalize('NFD')
    // Strip the combining marks NFD just separated: "Camille & Sacha à Lyon" keeps its
    // letters, loses its accents, so the URL survives copy-paste through any client.
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, '')

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

  static isReserved(candidate: string): boolean {
    return RESERVED.has(candidate)
  }

  static readonly minLength = MIN_LENGTH
  static readonly maxLength = MAX_LENGTH

  equals(other: Slug): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
