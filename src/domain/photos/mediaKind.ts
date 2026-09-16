/**
 * What a row on the wall actually is: a still photograph, or a short video clip.
 *
 * A clip is a **facet of `Photo`**, not a second aggregate. Everything a moderator, the
 * wall, the album and the quota do with a clip is what they already do with a photo —
 * it is pending until someone decides, it belongs to one event and one author, it
 * occupies bytes, it is deleted the same way. Modelling it separately would have meant a
 * second status machine, a second moderation queue, a second set of tenant-isolation
 * tests, and a wall that has to merge two orderings.
 *
 * So `kind` exists to be consulted where a **rule** genuinely differs, and nowhere else.
 * Everything mechanical — which variants exist, what extension and content type each
 * one has, which hash addresses the poster — is a table indexed by this value rather
 * than an `if`. That is not a style preference: `src/domain` and `src/application` are
 * gated at 100% branches, so every `if (kind === 'clip')` costs a photo test *and* a
 * clip test for the rest of the project's life, while a lookup costs neither.
 */

export const MEDIA_KINDS = ['photo', 'clip'] as const

export type MediaKind = (typeof MEDIA_KINDS)[number]

export const isMediaKind = (value: unknown): value is MediaKind =>
  typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value)
