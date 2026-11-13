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
 * The zero-width joiner and non-joiner (`Cf`, like the rest of the invisible class).
 *
 * Built from their code points rather than typed or escaped, so this file stays plain text in every
 * editor. They are not padding when they sit **between two characters**: ZWJ is what makes a family,
 * a flag-with-gender or a profession one emoji, and ZWNJ is part of how a Persian or an Indic word
 * is spelt. They are still removed where they can only be padding: leading, trailing, next to a
 * space, or doubled (see {@link keepJoinersBetweenCharacters}).
 */
const ZWNJ = String.fromCharCode(0x200c)
const ZWJ = String.fromCharCode(0x200d)
const JOINER_RUN = new RegExp(`[${ZWNJ}${ZWJ}]+`, 'gu')

/**
 * Keep a joiner only when it is alone between two characters that are not whitespace; strip it
 * when it is leading, trailing, next to whitespace (a line break included) or doubled.
 *
 * Runs on text whose other invisible characters are already gone, so what is left around a joiner
 * is what a reader would see around it.
 */
const keepJoinersBetweenCharacters = (run: string, offset: number, text: string): string => {
  if (run.length !== 1) return ''
  const before = text.charAt(offset - 1)
  const after = text.charAt(offset + 1)
  return before !== '' && after !== '' && !/\s/u.test(before) && !/\s/u.test(after) ? run : ''
}

/**
 * How many characters a reader sees: code points, not UTF-16 units, so an emoji is one and a limit
 * never cuts one in half. The one counter every length bound uses, so a name, a caption and a
 * guestbook message are measured the same way (the database's `length()` counts the same way too).
 */
export const characterCount = (text: string): number => [...text].length

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
const INVISIBLE_CLASS = String.raw`\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}`
const INVISIBLE = new RegExp(`(?![${ZWNJ}${ZWJ}])[${INVISIBLE_CLASS}]`, 'gu')

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
    .replace(JOINER_RUN, keepJoinersBetweenCharacters)
    .replace(/\s{2,}/gu, ' ')
    .trim()

/**
 * Everything invisible except the line feed, which a paragraph legitimately keeps, and the joiners,
 * which {@link keepJoinersBetweenCharacters} then judges.
 */
const INVISIBLE_KEEPING_NEWLINE = new RegExp(`(?![\n${ZWNJ}${ZWJ}])[${INVISIBLE_CLASS}]`, 'gu')

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
    .replace(JOINER_RUN, keepJoinersBetweenCharacters)
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ ?\n ?/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()

/**
 * Every separator a client may send for "a new line", read as `\n`: CRLF, a lone CR, and
 * the Unicode line (`U+2028`), paragraph (`U+2029`) and next-line (`U+0085`) separators.
 */
const LINE_SEPARATORS = /\r\n|[\r\u2028\u2029\u0085]/gu

/**
 * Several short lines of untrusted text: the host's welcome message.
 *
 * **The order is load-bearing, as in {@link toSingleLine}.** Separators become `\n`
 * first: `INVISIBLE` contains `Zl`, `Zp` and `Cc`, so stripping before converting would
 * glue two words that a client had separated with `U+2028`. Each line then gets the
 * single-line treatment, and blank lines are dropped (a decorative empty line would
 * spend one of the few lines the surface allows).
 *
 * The result may be empty; what that means is the caller's decision.
 */
export const toParagraphs = (raw: string): string =>
  raw
    .replace(LINE_SEPARATORS, '\n')
    .split('\n')
    .map(toSingleLine)
    .filter((line) => line.length > 0)
    .join('\n')
