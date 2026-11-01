/**
 * One line of untrusted text, fit to be rendered.
 *
 * Extracted from `photos/caption.ts`, which had the only copy, when `missions/
 * missionPrompt.ts` needed the same treatment. Two copies of this would have been two
 * copies of the `INVISIBLE` class below, and the failure mode of a second copy is
 * silent: a code point added to one of them goes on rendering as a replacement box —
 * or, for `U+202E`, goes on reversing the rest of the line — everywhere the other copy
 * is used, with nothing failing.
 *
 * This is **not** HTML escaping. React escapes on render, and nothing here writes
 * markup. What it removes is the set of characters that corrupt a line of text whatever
 * the escaping is, and it is the same set for a guest's caption under a photograph and
 * for a host's prompt beside it.
 */

/**
 * Whitespace a person can actually type, folded to a single space.
 *
 * Both callers render one line inside a fixed box: three pasted newlines in a caption
 * push the photo credit off the projector, and one inside a mission prompt makes a
 * checklist row twice the height of its neighbours.
 */
const LINE_BREAKS = /[\t\n\r\f\v]+/g

/**
 * Everything invisible, by Unicode general category rather than by a hand-listed range:
 *
 * - `Cc` — C0/C1 control codes.
 * - `Cf` — format characters. This is the important one: it covers the bidirectional
 *   overrides and isolates (`U+202E` alone can render the rest of the line
 *   right-to-left), the zero-width space and joiners used to pad a string past its
 *   visible length, and the byte-order mark.
 * - `Cs`, `Co`, `Cn` — lone surrogates, private-use and unassigned code points, which
 *   render as replacement boxes.
 * - `Zl`, `Zp` — line and paragraph separators, which some clients send instead of a
 *   newline.
 *
 * Ordinary space separators (`Zs`, including a non-breaking space) survive here and are
 * collapsed by the whitespace pass instead, because JavaScript's `\s` covers them.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu

/**
 * Fold to one line, drop what cannot be seen, collapse runs of space, trim.
 *
 * The order is load-bearing. Line breaks become spaces **before** the invisible pass,
 * so a newline separating two words does not silently join them; the invisible pass
 * runs before the space collapse, so a zero-width character between two spaces leaves
 * one space rather than two.
 *
 * The result may be empty. Deciding what that means — a cleared caption, a refused
 * prompt — belongs to the value object, not here.
 */
export const toSingleLine = (raw: string): string =>
  raw
    .replace(LINE_BREAKS, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s{2,}/gu, ' ')
    .trim()

/** Everything invisible except the line feed, which a paragraph of text legitimately keeps. */
const INVISIBLE_KEEPING_NEWLINE = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu

/**
 * A short paragraph of untrusted text, fit to be rendered with its line breaks (the guestbook).
 *
 * The sibling of {@link toSingleLine}, with the same invisible characters removed and one
 * difference: a line feed is kept, because a message of three lines is three lines. The order is
 * load-bearing for the same reasons. NFC comes first, so one visible character is one code point
 * and a length bound counts what a reader sees. Every kind of line break (`\r\n`, a lone `\r`,
 * `U+2028`, `U+2029`) is folded to `\n` **before** the invisible pass, so a separator does not
 * vanish and join two words. A tab becomes a space, runs of spaces fold to one, spaces around a
 * line break are dropped, and at most one blank line stays in a row.
 *
 * The result may be empty; what that means belongs to the value object.
 */
export const toMultiLine = (raw: string): string =>
  raw
    .normalize('NFC')
    .replace(/\r\n|[\r\u2028\u2029]/gu, '\n')
    .replace(/[\t\v\f]/gu, ' ')
    .replace(INVISIBLE_KEEPING_NEWLINE, '')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ ?\n ?/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
