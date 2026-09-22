import { z } from 'zod'
import { EVENT_LANGUAGES } from '../../../domain/events/eventLanguage'
import { EVENT_TEMPLATE_KEYS } from '../../../domain/events/eventTemplate'
import { MISSION_SCOPES } from '../../../domain/missions/missionScope'
import {
  accentHueRange,
  THEME_FONTS,
  THEME_FRAMES,
  THEME_MATERIALS,
} from '../../../domain/events/eventTheme'

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

/**
 * The renditions a client may ask for.
 *
 * `source` — a clip's un-stripped upload, waiting for the transcoder — is deliberately
 * absent, and its absence is a security control rather than an omission. Those bytes
 * still carry whatever the phone wrote into the container, including location, and they
 * live inside the media store so the event's purge and the reconciliation figure reach
 * them. The use case takes a `ServedVariant`, so even if this enum grew the value by
 * accident it would not compile.
 */
export const photoVariantParams = z.object({
  eventSlug: slug,
  photoId: uuid,
  variant: z.enum(['thumb', 'display', 'original', 'video', 'poster']),
})

export const clipJobParams = z.object({ eventSlug: slug, clipJobId: uuid })

export const reactionParams = z.object({
  eventSlug: slug,
  photoId: uuid,
  kind: z.enum(['love', 'laugh', 'wow', 'cheers', 'clap']),
})

export const moderatorParams = z.object({ eventSlug: slug, userId: uuid })

export const guestParams = z.object({ eventSlug: slug, guestId: uuid })

export const missionParams = z.object({ eventSlug: slug, missionId: uuid })

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
    /**
     * Which of the host's prompts the guest tapped (roadmap §2.1).
     *
     * Strictly a uuid rather than "any string the phone had", because this is the one
     * identifier in an upload that the *client* chose: rejecting a malformed one here
     * turns it into a `400` before it reaches a query, and a well-formed one that names
     * another event's row is refused by the use case's scoped lookup.
     *
     * Absent means "no mission", which is what the overwhelming majority of uploads at
     * an event are. `nullish` for the same reason `caption` has it: a client that spells
     * "none" as `null` and one that omits the part are saying the same thing.
     */
    missionId: z.string().uuid().nullish(),
  })
  .strict()

/**
 * The one text part a clip upload carries. Same bound and same reasoning as
 * {@link uploadFields}: the exact limit is `Caption`'s, this only keeps a multi-megabyte
 * field out of the domain.
 */
export const clipUploadFields = z
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
    /**
     * Which preset the event's settings start from (roadmap 3.5).
     *
     * `.optional()` and deliberately **not** `.nullish()`, unlike the two fields above
     * it. Those carry a "no limit" or "no printed start" intent that `null` spells; this
     * one does not — "no template" is the absence of a choice, and offering two spellings
     * of it would mean a client sending `null` and a client sending nothing having to be
     * shown to mean the same thing by a test rather than by the type.
     *
     * The vocabulary comes from the domain rather than a second `z.enum(['wedding', …])`
     * here: a fifth template would otherwise be accepted by the use case and refused at
     * the boundary, with nothing in either build noticing. A name outside it is
     * `400 request.invalid`, which is the answer every unknown enum value in this file
     * already gets — no new error code, and nothing for roadmap 1.5 to translate.
     */
    template: z.enum(EVENT_TEMPLATE_KEYS).optional(),
    /**
     * The language the room's screen will speak, read from the creator's browser at the
     * moment they create the event (roadmap 1.5).
     *
     * On the **create** body because that moment is the whole design of the default: the
     * one signal about a screen nobody will be holding is the language the person setting
     * it up is reading. **A snapshot, never a subscription** — nothing re-reads that
     * preference, so a host who switches their own browser next month has not moved a
     * projector in a room. `createEvent.test.ts` asserts it as an absence.
     *
     * `.optional()` and not `.nullish()`, like `template`: "no opinion" is the absence of
     * a choice, and the domain answers it with French.
     */
    wallLanguage: z.enum(EVENT_LANGUAGES).optional(),
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
    allowClips: z.boolean().optional(),
    allowGuestSelfDelete: z.boolean().optional(),
    guestSelfDeleteGraceSeconds: z.number().int().min(0).max(86_400).optional(),
    retentionDays: z.number().int().min(1).max(3_650).nullable().optional(),
    maxPhotosPerGuest: z.number().int().min(1).max(10_000).nullable().optional(),
    /**
     * The event's look (roadmap 2.2, and the material since 11.5). One object with four
     * required keys, which is not the partial-update shape its neighbours use.
     *
     * Same argument as `eventScheduleBody` below: this is one decision made on one form,
     * and the legibility rule in `src/domain/events/eventTheme.ts` judges them
     * together. Sending an accent without saying which font it goes with would make the
     * server merge half a theme, which is a palette nobody chose.
     *
     * The bounds and the vocabularies come from the domain rather than being restated —
     * a second copy of `0-359` here is a second thing to forget. What this schema does
     * *not* do is decide legibility: `z.number().int().min(0).max(359)` is the shape of a
     * hue, and whether a hue can be read at ten metres is a rule, not a shape.
     *
     * **`material` is required like the other three, and that has a cost worth naming.** A
     * tab left open across the deploy that adds it sends three keys and is answered
     * `400 request.invalid` on save, until it is reloaded. The alternative — accepting a
     * theme without it — is worse in the direction this repository cares about: absent
     * would have to mean something, the only sane meaning is `glass`, and a host who chose
     * `plain` would have it silently undone by an old tab saving an unrelated checkbox.
     * A refusal a reload fixes beats a choice quietly reverted.
     */
    theme: z
      .object({
        accentHue: z.number().int().min(accentHueRange.min).max(accentHueRange.max),
        fonts: z.enum(THEME_FONTS),
        frame: z.enum(THEME_FRAMES),
        material: z.enum(THEME_MATERIALS),
      })
      .strict()
      .optional(),
    /**
     * The language the projected wall speaks (roadmap 1.5).
     *
     * A scalar beside the theme's object rather than folded into it: `eventTheme.ts`
     * weighs its four values against each other for legibility at ten metres and a
     * language takes part in none of that, and `theme` is required-whole on purpose — so
     * folding it in would make a host who changes only the language resend a palette.
     *
     * The vocabulary comes from the domain rather than a second `z.enum(['fr', …])`, for
     * the reason `template` does: a language added to the build would otherwise be
     * accepted by the use case and refused here, with neither build noticing.
     */
    wallLanguage: z.enum(EVENT_LANGUAGES).optional(),
  })
  .strict()

export const eventStatusBody = z
  .object({
    status: z.enum(['draft', 'live', 'closed', 'archived']),
  })
  .strict()

/**
 * The scheduled opening and closing, as **instants**.
 *
 * Both keys are required and nullable, which is not the partial-update shape
 * `updateSettingsBody` uses directly above. The difference is deliberate: this is one
 * form with two fields that are read together, and "open at 18:00" with `closesAt`
 * absent is ambiguous in a way the settings form's fields are not — it could mean
 * "leave the closing alone" or "there is no closing". Sending both every time makes the
 * host's screen and the stored row the same thing, and `null` says "I will do this one
 * myself" without a second spelling.
 *
 * **`{ offset: true }` is load-bearing.** Bare `z.string().datetime()` accepts `Z` and
 * *rejects* every other offset, so `2026-06-20T18:00:00+02:00` — a perfectly ordinary
 * instant, and what a third-party client in Paris would naturally send — was answered
 * `400 request.invalid` while this comment and docs/API.md both promised it worked. With
 * the option on, any RFC-3339 offset is accepted and a string with **no** offset still is
 * not, which is the rule that matters: the server does not know what time it is at the
 * venue and must not guess at a wall-clock string.
 *
 * The browser resolves the host's local 18:00 to an instant before sending. Whether the
 * closing comes after the opening, and whether either has already gone by, are
 * `Event.reschedule`'s rules and not a `z.refine` — the second one needs the clock, which
 * is a port.
 */
export const eventScheduleBody = z
  .object({
    scheduledOpenAt: z.string().datetime({ offset: true }).nullable(),
    scheduledCloseAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()

export const inviteModeratorBody = z
  .object({
    email: z.string().min(1).max(254),
  })
  .strict()

// --------------------------------------------------------------------- missions --

/**
 * One prompt as the host writes it (roadmap §2.1).
 *
 * The same body for creating and for replacing, and both fields are required on both —
 * the shape `eventScheduleBody` uses and for the same reason. A prompt and who it is
 * asked of are one decision made on one row of one form, and a partial update would let
 * a scope be persisted beside a prompt the domain refused.
 *
 * The bound is generous and is not the limit: `MissionPrompt` decides what a projector
 * can carry, sanitises what is invisible, and owns the error codes. What this does is
 * keep a multi-kilobyte field out of the domain. The vocabulary comes from the domain
 * rather than a second `z.enum(['guest', 'event'])`, so a third scope could not be
 * accepted by the use case and refused at the boundary with nothing noticing.
 */
export const missionBody = z
  .object({
    prompt: z.string().max(1_000),
    scope: z.enum(MISSION_SCOPES),
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

/**
 * Deliberately **no `cursor`**, unlike `photoListQuery` directly above.
 *
 * This queue is not cursor-paged and cannot be: the domain orders the whole filtered
 * set *before* applying `limit`, precisely so the oldest pending photo cannot be pushed
 * off the page by newer arrivals. A cursor names a position in a stable order, and this
 * order is recomputed against live uploads on every read — the same request would
 * resume from a row that has moved. The host's paged surface is the gallery,
 * `GET /events/:eventSlug/photos`, which is newest-first and stable and is what
 * `photoListQuery` is for.
 *
 * The field used to be accepted here, bounded, and read by nothing, which is the one
 * thing `.strict()` exists to prevent: a refused field teaches the caller something, an
 * accepted one that changes no answer lies to them. Sending `?cursor=` is now a
 * `400 request.invalid`.
 */
export const moderationQueueQuery = z
  .object({
    status: z.enum(['pending', 'published', 'rejected', 'hidden', 'all']).default('pending'),
    limit: z.coerce.number().int().min(1).max(200).default(60),
  })
  .strict()

/**
 * The host's guest list takes **no parameter at all**, and the empty schema is still
 * parsed so that sending one is a `400 request.invalid`.
 *
 * It used to declare `activeWithinMinutes`, integer 1..1440, default 30, and the route
 * threw the parsed value away: `listGuests` has always answered with its own five-minute
 * window. A host asking for "active in the last two hours" was given five minutes, with
 * no error and nothing in the response to say so.
 *
 * Removed rather than threaded through, because **what counts as "at the party" is one
 * rule, not a caller's choice**. `activeCount` is rendered as a single number labelled
 * *présents* on a console that is read across a room; a window the caller picks makes
 * the same field mean something different to the console, to a second screen, and to the
 * tests, with nothing on the wire saying which. It is the same call this file already
 * makes for `layout` on `wallQuery` below, and the one `moderationRoutes` makes by not
 * reading an order off the query string. `listGuests.ts` holds the window and the reason
 * it is five minutes.
 *
 * Keeping the empty object rather than dropping the parse is what preserves the promise
 * in docs/API.md §1 that query strings are `.strict()` too: `?activeWithinMinutes=120`
 * is now told it had no effect instead of appearing to have had one.
 */
export const guestListQuery = z.object({}).strict()

/**
 * The display timing overrides the Playwright suite drives, so a visual test does not
 * wait ten real seconds per slide.
 *
 * **This server reads neither.** They are honoured in the browser, by
 * `web/src/features/wall/hooks/useTimingOverrides.ts`, off the *display* URL — the wall
 * route passes `slideIntervalMs: null` unconditionally and `publicRoutes.test.ts` pins
 * that with both states of the `E2E_HOOKS` flag, because a config flag must not be what
 * protects the room. This comment used to claim the route honoured them under
 * `E2E_HOOKS=1`, which described a design that is not here; the two fields themselves
 * are still accepted by nothing that reads them, and that is docs/API.md §9.5.
 *
 * There is deliberately no `layout` here. The wall's layout is a presentation choice
 * made at the screen — the host's `L` shortcut and `?layout=` on the *display* URL,
 * both read in the browser by `web/src/features/wall/` — so accepting one on a read
 * endpoint would only have the server hold the client's own view state for the length
 * of one request. `.strict()` therefore answers `400 request.invalid` for it, which is
 * the same answer every other unknown parameter gets.
 */
export const wallQuery = z
  .object({
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

// ------------------------------------------------ event routes (additive) --

/**
 * The invitation form, in full.
 *
 * `inviteModeratorBody` above carries only the address, which is all the table in
 * docs/API.md names — but `registerModerator` also needs the temporary password the
 * host reads out to the person they are handing the laptop to, and there is no mailer
 * in this product to send one instead. It is not generated here: the HTTP layer holds
 * no `IdGenerator`, and a controller inventing a credential is exactly the kind of
 * decision this layer must not make.
 *
 * Bounded only in length, like `loginBody`. The password policy belongs to `Password`,
 * and repeating it here would be a second implementation that drifts — and one that
 * would refuse the host's input before the domain could explain why.
 */
export const moderatorInvitationBody = inviteModeratorBody
  .extend({
    displayName: z.string().max(120).nullish(),
    temporaryPassword: z.string().min(1).max(1_000),
  })
  .strict()

// ----------------------------------------------------------- shared gallery --

/**
 * The host's link (roadmap §4.1): how many days it lasts, and whether it asks for a
 * password. Both optional — a month and no password is a link — and the bounds are the
 * domain's (`ShareLinkLifetime`), not repeated here: `.int()` is shape, "at most ninety"
 * is policy. The password is bounded only so an unbounded string never reaches bcrypt.
 */
export const shareLinkBody = z
  .object({
    expiresInDays: z.number().int().optional(),
    password: z.string().max(200).nullable().optional(),
  })
  .strict()

/**
 * A 256-bit token, base64url: exactly 43 characters. Parsed with `safeParse` by the
 * routes, which answer anything else with the same `gallery.notAvailable` an unknown
 * token gets — a malformed link and a dead one must be indistinguishable too.
 */
export const galleryTokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })

export const galleryUnlockBody = z.object({ password: z.string().min(1).max(200) }).strict()

/** Sealed by the server; bounded here so an unbounded string never reaches the MAC. */
export const galleryPhotosQuery = z
  .object({ cursor: z.string().min(1).max(1024).optional() })
  .strict()

/** One signed media URL: the path names what, the query proves it was granted. */
export const galleryMediaParams = z.object({
  linkId: uuid,
  photoId: uuid,
  variant: z.enum(['thumb', 'display', 'original', 'video', 'poster']),
})

export const galleryArchiveParams = z.object({ linkId: uuid })

/**
 * `e` is the grant's expiry in epoch milliseconds, `s` its signature — 43 base64url
 * characters, the length of an HMAC-SHA256. Short names because they travel on every
 * thumbnail of a grid. `.strict()`, so a URL carrying anything else was not one of ours.
 */
export const galleryGrantQuery = z
  .object({
    e: z.coerce.number().int().positive(),
    s: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict()
