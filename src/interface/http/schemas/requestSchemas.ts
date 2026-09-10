import { z } from 'zod'

/**
 * Boundary parsing. Every part of a request a route reads is parsed here first.
 *
 * These describe **shape**, never business rules. "The event must not be archived" and
 * "the caption must be at most 140 characters" belong to the domain: a `z.refine` that
 * duplicates a domain rule is a second implementation that will drift, and the domain
 * has the tests. What zod does is guarantee a use case never receives a number where
 * it expected a string.
 *
 * `.strict()` on bodies is deliberate. An unexpected key usually means the client and
 * this contract disagree, and failing loudly at the boundary beats a silently ignored
 * field that the sender believes took effect.
 */

/** Matches `Slug`'s own rule so a malformed slug is a 400, not a database round-trip. */
const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

const uuid = z.string().uuid()

/**
 * Deliberately loose: the domain's `JoinCode.create` normalises case, separators and
 * confusable characters, so rejecting them here would undo the typo tolerance that
 * exists for a guest reading a printed card in a dark room. Only the length is bounded,
 * to keep an unbounded string out of the parser.
 */
const joinCode = z.string().min(1).max(32)

export const eventSlugParams = z.object({ eventSlug: slug })

export const photoParams = z.object({ eventSlug: slug, photoId: uuid })

export const photoVariantParams = z.object({
  eventSlug: slug,
  photoId: uuid,
  variant: z.enum(['thumb', 'display', 'original']),
})

export const reactionParams = z.object({
  eventSlug: slug,
  photoId: uuid,
  kind: z.enum(['love', 'laugh', 'wow', 'cheers', 'clap']),
})

export const moderatorParams = z.object({ eventSlug: slug, userId: uuid })

export const guestParams = z.object({ eventSlug: slug, guestId: uuid })

// ------------------------------------------------------------------- public --

export const joinBody = z
  .object({
    joinCode,
    // `null` and `''` both mean "stay anonymous", which is what an untouched field
    // sends. Anonymity is a supported choice, not a validation failure.
    displayName: z.string().max(120).nullish(),
  })
  .strict()

// -------------------------------------------------------------------- guest --

/**
 * The caption on an upload. Bounded generously here — the exact limit and the
 * character sanitising are the `Caption` value object's job — but bounded, so a
 * multi-megabyte field cannot reach the domain.
 */
export const uploadFields = z
  .object({
    caption: z.string().max(1_000).nullish(),
  })
  .strict()

export const captionBody = z
  .object({
    caption: z.string().max(1_000).nullable(),
  })
  .strict()

export const reactionBody = z
  .object({
    kind: z.enum(['love', 'laugh', 'wow', 'cheers', 'clap']),
  })
  .strict()

// --------------------------------------------------------------------- auth --

export const loginBody = z
  .object({
    email: z.string().min(1).max(254),
    // Not length-checked: the policy applies when a password is *chosen*, and an
    // account whose password predates a policy change must still be able to sign in.
    // A minimum here would also leak which passwords are plausible.
    password: z.string().min(1).max(1_000),
  })
  .strict()

export const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1).max(1_000),
    newPassword: z.string().min(1).max(1_000),
  })
  .strict()

// ------------------------------------------------------------------- events --

export const createEventBody = z
  .object({
    name: z.string().min(1).max(200),
    // Optional: derived from the name by the same function the UI previews with.
    slug: slug.optional(),
    startsAt: z.string().datetime().nullish(),
    quotaBytes: z.number().int().positive().nullish(),
  })
  .strict()

export const renameEventBody = z.object({ name: z.string().min(1).max(200) }).strict()

/**
 * A partial update: an absent key means "leave it alone", which is why every field is
 * optional and why `exactOptionalPropertyTypes` matters downstream — `undefined` and
 * "cleared" are different intents. `retentionDays: null` clears retention;
 * `retentionDays` absent leaves it as it was.
 */
export const updateSettingsBody = z
  .object({
    moderation: z.enum(['manual', 'auto']).optional(),
    allowCaptions: z.boolean().optional(),
    allowReactions: z.boolean().optional(),
    allowGuestSelfDelete: z.boolean().optional(),
    guestSelfDeleteGraceSeconds: z.number().int().min(0).max(86_400).optional(),
    retentionDays: z.number().int().min(1).max(3_650).nullable().optional(),
    maxPhotosPerGuest: z.number().int().min(1).max(10_000).nullable().optional(),
  })
  .strict()

export const eventStatusBody = z
  .object({
    status: z.enum(['draft', 'live', 'closed', 'archived']),
  })
  .strict()

export const inviteModeratorBody = z
  .object({
    email: z.string().min(1).max(254),
  })
  .strict()

// --------------------------------------------------------------- moderation --

export const moderationDecisionBody = z
  .object({
    decision: z.enum(['publish', 'reject', 'hide']),
  })
  .strict()

export const bulkModerationBody = z
  .object({
    // Bounded: a bulk action is a screenful, not an entire album. An unbounded array
    // would let one request hold a transaction open across four thousand rows.
    photoIds: z.array(uuid).min(1).max(200),
    decision: z.enum(['publish', 'reject', 'hide']),
  })
  .strict()

// ------------------------------------------------------------------ queries --

/** `z.coerce` because query values arrive as strings. */
export const photoListQuery = z
  .object({
    status: z.enum(['pending', 'published', 'rejected', 'hidden', 'all']).default('all'),
    limit: z.coerce.number().int().min(1).max(200).default(60),
    cursor: z.string().max(512).optional(),
  })
  .strict()

export const moderationQueueQuery = z
  .object({
    status: z.enum(['pending', 'published', 'rejected', 'hidden', 'all']).default('pending'),
    limit: z.coerce.number().int().min(1).max(200).default(60),
    cursor: z.string().max(512).optional(),
  })
  .strict()

export const guestListQuery = z
  .object({
    /** How long since `lastSeenAt` still counts as "at the party". */
    activeWithinMinutes: z.coerce.number().int().min(1).max(1_440).default(30),
  })
  .strict()

/**
 * The display timing overrides the Playwright suite drives, so a visual test does not
 * wait ten real seconds per slide. Only honoured when the server was started with
 * `E2E_HOOKS=1`; the route drops them otherwise, and the config module refuses to boot
 * production with that flag set.
 */
export const wallQuery = z
  .object({
    layout: z.enum(['spotlight', 'mosaic', 'polaroid', 'filmstrip']).optional(),
    e2e_interval: z.coerce.number().int().min(50).max(600_000).optional(),
    e2e_transition: z.coerce.number().int().min(0).max(10_000).optional(),
  })
  .strict()

// ------------------------------------------- moderation routes (additive) --

/**
 * "Photo de la soirée". Bounded low on purpose: the panel is projected, and a podium
 * of forty photos is not a podium. The default is what the client asks for when it
 * sends no query at all.
 */
export const topPhotosQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict()
