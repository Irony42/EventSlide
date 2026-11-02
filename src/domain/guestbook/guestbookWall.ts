/**
 * How the room shows guestbook messages (spec 01, the wall).
 *
 * Decided here and sent in `/wall`, never recomputed by the browser: `web/` imports no domain, and
 * the rhythm of a projector is a product decision, not a view detail.
 */

/** A message card comes up after this many photographs. */
export const GUESTBOOK_WALL_EVERY_NTH = 6

/** The least a card stays up, however short the message. */
export const GUESTBOOK_WALL_MIN_MS = 6_000

/** What each character adds: a reader at ten metres needs the time. */
export const GUESTBOOK_WALL_MS_PER_CHARACTER = 60

/** The most a card stays up, so a 500-character message cannot hold the screen for a minute. */
export const GUESTBOOK_WALL_MAX_MS = 20_000

/** The newest messages the wall carries: the response stays small on a venue's Wi-Fi. */
export const GUESTBOOK_WALL_MAX_MESSAGES = 100

/** How long a card of this many characters stays on the screen. */
export const messageDisplayMs = (characters: number): number =>
  Math.min(
    GUESTBOOK_WALL_MAX_MS,
    GUESTBOOK_WALL_MIN_MS + Math.max(0, characters) * GUESTBOOK_WALL_MS_PER_CHARACTER,
  )
