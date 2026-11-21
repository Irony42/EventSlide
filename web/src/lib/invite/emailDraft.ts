import type { Locale } from '../i18n/locale'
import { translationsFor } from '../i18n/translations'
import { graphemesOf } from './cardTexts'
import { addressLine } from './shareText'
import { wellFormed } from './wellFormed'

/**
 * The e-mail an invitation is sent in, and the `mailto:` link that opens it (spec 29). The host
 * writes from **their own** mailbox: EventSlide sends nothing, keeps no address and puts **no
 * recipient** in the link (the host adds their guests, in blind copy, themselves).
 *
 * Pure: the draft is a function of the invitation, the link a function of the draft, so each is
 * tested without a screen. The words around the host's are in the language of the invitation; the
 * host's own (title, place, word) go through as written.
 */

export interface EmailDraftParts {
  readonly title: string
  /** "samedi 11 décembre 2027" and "19 h – 2 h", as `whenParts` writes them. */
  readonly day: string
  readonly hours: string
  /** "samedi 11 décembre": the subject names the day, not the year. */
  readonly dayMonth: string
  readonly venue: string | null
  /** Paper and mail go to the guests the host chose: the address is in the mail. */
  readonly address: string | null
  /** The host's whole word, never the short one of the card. */
  readonly message: string | null
  /** The invitation's link, with its scheme. */
  readonly url: string
}

export interface EmailDraft {
  readonly subject: string
  readonly body: string
}

/** What a link to a mailbox may weigh once encoded: Outlook and some browsers refuse more. */
export const MAILTO_MAX = 1800

/** A subject is one short line: the field holds no more, and the link cuts it before it would not fit. */
export const SUBJECT_MAX = 200

const LOWER_CASE_DAYS: readonly Locale[] = ['fr', 'es', 'it']

export const emailDraftOf = (parts: EmailDraftParts, lang: Locale): EmailDraft => {
  const card = translationsFor(lang).guestInvite.card
  const place = [parts.venue, parts.address === null ? null : addressLine(parts.address)]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ')
  const word = parts.message?.trim() ?? ''
  // A weekday is written in lower case in French, Spanish and Italian, with a capital in English and German.
  const day = LOWER_CASE_DAYS.includes(lang)
    ? parts.dayMonth.replace(/^./u, (first) => first.toLocaleLowerCase(lang))
    : parts.dayMonth
  return {
    subject: card.mailSubject(parts.title, day),
    body: [
      card.mailHello,
      '',
      card.mailIntro(parts.title),
      '',
      `${card.whenLabel}${separator(lang)} ${upperFirst(parts.day, lang)}, ${parts.hours}`,
      ...(place === '' ? [] : [`${card.whereLabel}${separator(lang)} ${place}`]),
      '',
      ...(word === '' ? [] : [word, '']),
      card.mailDetails,
      parts.url,
    ].join('\n'),
  }
}

/** French sets a no-break space before the colon of a label. */
const separator = (lang: Locale): string => (lang === 'fr' ? ' :' : ':')

const upperFirst = (text: string, lang: Locale): string =>
  text === '' ? text : `${text.charAt(0).toLocaleUpperCase(lang)}${text.slice(1)}`

export interface MailtoLink {
  readonly href: string
  /** Characters of the link once encoded. */
  readonly length: number
  /** The body was cut to fit: its end points to the invitation page. */
  readonly cut: boolean
  /** Some of the host's text is still in a body that was cut (it is not only the page and the link). */
  readonly wordLeft: boolean
}

/**
 * `mailto:?subject=…&body=…`, **no recipient**. The subject is one line (a line break there would
 * be a second header to some clients), and every text is made well formed first (half of an emoji
 * would make `encodeURIComponent` throw while the page renders).
 *
 * Over {@link MAILTO_MAX} once **encoded** (an accented letter is six characters, an emoji twelve),
 * the body is cut at a grapheme, never in the middle of an emoji, a flag or an accent, and ends on
 * "… (suite sur la page de l'invitation)" and **the link, which is always kept**, even when the host
 * deleted it from the text. A subject too long for the link to fit with the page and the link is
 * cut too.
 */
export const mailtoHref = (draft: EmailDraft, url: string, lang: Locale): MailtoLink => {
  const address = wellFormed(url)
  const subject = wellFormed(draft.subject)
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim()
  const written = wellFormed(draft.body)
  const link = (line: string, body: string) =>
    `mailto:?subject=${encodeURIComponent(line)}&body=${encodeURIComponent(body)}`

  // The link is always kept: a text with none gets it at its end.
  const body = written.includes(address) ? written : `${written.trimEnd()}\n\n${address}`
  const whole = link(subject, body)
  if (whole.length <= MAILTO_MAX) {
    return { href: whole, length: whole.length, cut: false, wordLeft: true }
  }

  const tail = `… ${translationsFor(lang).guestInvite.card.mailMore}\n\n${address}`

  // A subject that alone leaves no room for the page and the link is cut first.
  const letters = graphemesOf(subject)
  const cutSubject = (kept: number) =>
    kept >= letters.length ? subject : `${letters.slice(0, kept).join('').trimEnd()}…`
  let fit = letters.length
  if (link(subject, tail).length > MAILTO_MAX) {
    let low = 0
    let high = letters.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (link(cutSubject(middle), tail).length <= MAILTO_MAX) low = middle
      else high = middle - 1
    }
    fit = low
  }
  const line = cutSubject(fit)

  // Everything but the link is what may be cut, from its end.
  const at = body.lastIndexOf(address)
  const head = graphemesOf(body.slice(0, at).trimEnd())
  const made = (kept: number) => link(line, `${head.slice(0, kept).join('').trimEnd()}${tail}`)

  let low = 0
  let high = head.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (made(middle).length <= MAILTO_MAX) low = middle
    else high = middle - 1
  }
  const href = made(low)
  return { href, length: href.length, cut: true, wordLeft: low > 0 }
}
