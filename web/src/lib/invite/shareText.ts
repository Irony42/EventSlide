import type { Locale } from '../i18n/locale'
import { translationsFor } from '../i18n/translations'
import { graphemesOf } from './cardTexts'

/**
 * The text that goes with the invitation image (spec 29): a line saying who invites to what, the
 * moment and the place, then the link. In the language of the invitation, the host's own words as
 * written. It never ends on an exclamation mark (the design system has no decorative one).
 *
 * `address` is `null` unless the host chose to show it: this text is posted where everyone sees it.
 */
export interface ShareTextParts {
  readonly title: string
  /** "samedi 11 décembre 2027" and "19 h – 2 h", as `whenParts` writes them. */
  readonly day: string
  readonly hours: string
  readonly venue: string | null
  readonly address: string | null
  /** The full link, with its scheme: the one a phone makes clickable. */
  readonly url: string
}

/** What a post carries: a message app and a story caption both stop reading long before this. */
export const SHARE_TEXT_MAX = 600

const upperFirst = (text: string, lang: Locale): string =>
  text === '' ? text : `${text.charAt(0).toLocaleUpperCase(lang)}${text.slice(1)}`

/** `text` cut to `max` graphemes, ending on an ellipsis when it was cut. */
const cutTo = (text: string, max: number): string => {
  const points = graphemesOf(text)
  if (points.length <= max) return text
  if (max <= 1) return max === 1 ? '…' : ''
  return `${points
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`
}

/** The address as one line: its lines joined by commas. */
export const addressLine = (address: string): string => address.replace(/\s*\n\s*/g, ', ')

/**
 * The text, **never longer than {@link SHARE_TEXT_MAX} characters and never without its link**:
 * what gives way is the place (the venue, then the address), then the title, in that order.
 */
export const shareTextOf = (parts: ShareTextParts, lang: Locale): string => {
  const card = translationsFor(lang).guestInvite.card
  const when = `${upperFirst(parts.day, lang)}, ${parts.hours}`
  const build = (title: string, where: string): string =>
    [
      card.shareIntro(title),
      where === '' ? when : `${when} · ${where}`,
      '',
      card.link(parts.url),
    ].join('\n')
  const whereOf = (venue: string | null, address: string | null): string =>
    [venue, address === null ? null : addressLine(address)]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · ')

  const whole = build(parts.title, whereOf(parts.venue, parts.address))
  if (graphemesOf(whole).length <= SHARE_TEXT_MAX) return whole

  // The place gives way first: room is what is left once the rest is written.
  const without = build(parts.title, '')
  const room = SHARE_TEXT_MAX - graphemesOf(without).length - 3
  if (room >= 12) {
    const where = cutTo(whereOf(parts.venue, parts.address), room)
    return build(parts.title, where)
  }
  // Then the title: the link and the moment stay.
  const bare = build('', '')
  const spare = SHARE_TEXT_MAX - graphemesOf(bare).length
  return build(cutTo(parts.title, Math.max(1, spare)), '')
}

/**
 * The text again without the address, for a host who edited it and then took the address off the
 * image: the address as one line (after its ` · `), or as it was typed. `null` when a trace of it
 * is still there afterwards (the host retyped it): the caller then starts over from the generated
 * text rather than post an address the host believes is gone.
 */
export const withoutAddress = (text: string, address: string): string | null => {
  const joined = addressLine(address)
  let stripped = text
  for (const variant of [` · ${joined}`, `, ${joined}`, joined, address]) {
    stripped = stripped.split(variant).join('')
  }
  const lines = address
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return lines.some((line) => stripped.includes(line)) ? null : stripped
}
