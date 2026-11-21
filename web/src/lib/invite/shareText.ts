import type { Locale } from '../i18n/locale'
import { translationsFor } from '../i18n/translations'

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

const upperFirst = (text: string, lang: Locale): string =>
  text === '' ? text : `${text.charAt(0).toLocaleUpperCase(lang)}${text.slice(1)}`

export const shareTextOf = (parts: ShareTextParts, lang: Locale): string => {
  const card = translationsFor(lang).guestInvite.card
  const when = `${upperFirst(parts.day, lang)}, ${parts.hours}`
  const where = [parts.venue, parts.address?.replace(/\s*\n\s*/g, ', ') ?? null]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ')
  return [
    card.shareIntro(parts.title),
    where === '' ? when : `${when} · ${where}`,
    '',
    card.link(parts.url),
  ].join('\n')
}
