import { toSingleLine } from '../shared/plainText'

/**
 * What the embedded PDF font is required to cover: Latin (extended), Cyrillic, Greek,
 * decimal digits, combining marks, ASCII, Latin-1 punctuation and the general punctuation
 * block, plus the euro sign and the trade mark. The font chosen for the adapter must cover
 * this set; anything outside it is omitted, never drawn as a box.
 */
export const PDF_FONT_COVERAGE =
  /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Nd}\p{M}]|[ -~¡-¿×÷‐-‧‰-⁞€™]/u

/** Emoji pieces that survive `toSingleLine`: variation selectors and the keycap mark. */
const EMOJI_LEFTOVERS = /[︀-️⃣]/gu
const PICTOGRAPHS = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/gu

/**
 * Guest text (a first name, a caption) made drawable: control and invisible characters
 * removed, emoji and every glyph the font lacks **omitted** (never replaced by a box),
 * then cut to `maxLength` characters (code points). Content is otherwise kept as written:
 * never translated, never corrected. May return the empty string.
 */
export const pdfSafeText = (raw: string, maxLength: number): string => {
  const cleaned = toSingleLine(raw.replace(PICTOGRAPHS, '').replace(EMOJI_LEFTOVERS, ''))
  const drawable = Array.from(cleaned)
    .filter((character) => PDF_FONT_COVERAGE.test(character))
    .join('')
  return Array.from(toSingleLine(drawable)).slice(0, maxLength).join('').trim()
}
