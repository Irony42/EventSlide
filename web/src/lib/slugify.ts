/**
 * The event slug, folded from a human name.
 *
 * A transcription of `slugify` in `src/domain/shared/slug.ts`, kept character for
 * character. The host-facing create form previews the slug while they type, and the
 * server derives the same slug when the field is left empty — two implementations that
 * disagree is exactly how "the slug I saw is not the slug I got" happens. Lint forbids
 * importing the domain (the web app talks HTTP only), so `slugify.test.ts` pins this
 * against the very cases the domain's own test asserts.
 */

/** Published by `Slug` on the server. Here only to bound the preview, never to validate. */
export const SLUG_MAX_LENGTH = 64
export const SLUG_MIN_LENGTH = 2

export const slugify = (raw: string): string =>
  raw
    .normalize('NFD')
    // Strip the combining marks NFD just separated: "Camille & Sacha à Lyon" keeps its
    // letters, loses its accents, so the URL survives copy-paste through any client.
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '')
