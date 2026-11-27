import type { ClientLocale } from '../clients/clientLocale'
import type { EmailAddress } from '../users/emailAddress'
import type { OutgoingMail } from './outgoingMail'
import { toSingleLine } from '../shared/plainText'

/**
 * The mails about the guests' replies (spec 32, section 8). This file holds the first one, **R1: the warning
 * before the replies are erased**, 7 days and 1 day before, to the owners of the event.
 *
 * - **Numbers and the event's name only.** The replies hold names and sometimes diets; the mail says how many
 *   there are and when they go, never who. The event's name is the one the host typed, folded to one line like
 *   every name that goes into a header (`toSingleLine`). The last line says so.
 * - **The date is a day in UTC**, spelt by the language, because the retention counts in UTC days (as the purge
 *   warning does).
 * - Plain text, one link (the replies page, where the list is downloaded), no tracking.
 * - R1 has no family: no switch turns it off, so there is no "how to stop these mails" line.
 *
 * Pure: a function of its arguments.
 */

export interface RsvpErasureMailInput {
  readonly to: EmailAddress
  readonly locale: ClientLocale
  /** The event's name, as the host typed it. */
  readonly eventName: string
  /** When the replies are erased. */
  readonly erasureDate: Date
  /** How many replies there are today: a number, never who. */
  readonly replies: number
  /** The replies page, absolute (`PUBLIC_URL` and its path). */
  readonly pageUrl: string
}

interface Template {
  readonly subject: (name: string, date: string) => string
  readonly greeting: string
  readonly body: (name: string, date: string, count: string) => string
  readonly count: (replies: number) => string
  readonly open: string
  readonly noNames: string
}

/** A real no-break space, for the French spacing before `:` and inside « ». */
const NBSP = String.fromCharCode(160)

const TEMPLATES: Readonly<Record<ClientLocale, Template>> = {
  fr: {
    subject: (name, date) => `Les réponses de «${NBSP}${name}${NBSP}» seront effacées le ${date}`,
    greeting: 'Bonjour,',
    body: (name, date, count) =>
      `Les réponses de vos invités à «${NBSP}${name}${NBSP}» (${count}) seront effacées le ${date}. ` +
      'Téléchargez la liste au plus tard la veille.',
    count: (replies) => `${replies} réponse${replies > 1 ? 's' : ''}`,
    open: `Pour la télécharger${NBSP}:`,
    noNames: 'Ce message ne contient le nom d’aucun invité.',
  },
  en: {
    subject: (name, date) => `The replies to "${name}" will be erased on ${date}`,
    greeting: 'Hello,',
    body: (name, date, count) =>
      `Your guests' replies to "${name}" (${count}) will be erased on ${date}. ` +
      'Download the list the day before at the latest.',
    count: (replies) => `${replies} ${replies === 1 ? 'reply' : 'replies'}`,
    open: 'To download it, open:',
    noNames: 'This message contains no guest name.',
  },
  de: {
    subject: (name, date) => `Die Antworten zu „${name}“ werden am ${date} gelöscht`,
    greeting: 'Guten Tag,',
    body: (name, date, count) =>
      `Die Antworten Ihrer Gäste zu „${name}“ (${count}) werden am ${date} gelöscht. ` +
      'Laden Sie die Liste spätestens am Vortag herunter.',
    count: (replies) => `${replies} ${replies === 1 ? 'Antwort' : 'Antworten'}`,
    open: 'Zum Herunterladen öffnen Sie:',
    noNames: 'Diese Nachricht enthält keinen Namen eines Gastes.',
  },
  es: {
    subject: (name, date) => `Las respuestas a «${name}» se eliminarán el ${date}`,
    greeting: 'Hola,',
    body: (name, date, count) =>
      `Las respuestas de sus invitados a «${name}» (${count}) se eliminarán el ${date}. ` +
      'Descargue la lista a más tardar el día anterior.',
    count: (replies) => `${replies} ${replies === 1 ? 'respuesta' : 'respuestas'}`,
    open: 'Para descargarla, abra:',
    noNames: 'Este mensaje no contiene el nombre de ningún invitado.',
  },
  it: {
    subject: (name, date) => `Le risposte a «${name}» verranno eliminate il ${date}`,
    greeting: 'Buongiorno,',
    body: (name, date, count) =>
      `Le risposte dei suoi ospiti a «${name}» (${count}) verranno eliminate il ${date}. ` +
      'Scarichi la lista al più tardi il giorno prima.',
    count: (replies) => `${replies} ${replies === 1 ? 'risposta' : 'risposte'}`,
    open: 'Per scaricarla, apra:',
    noNames: 'Questo messaggio non contiene il nome di alcun ospite.',
  },
}

const dateIn = (locale: ClientLocale, at: Date): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(at)

export const rsvpErasureMail = ({
  to,
  locale,
  eventName,
  erasureDate,
  replies,
  pageUrl,
}: RsvpErasureMailInput): OutgoingMail => {
  const template = TEMPLATES[locale]
  const name = toSingleLine(eventName)
  const date = dateIn(locale, erasureDate)

  return {
    to,
    subject: template.subject(name, date),
    text: [
      template.greeting,
      '',
      template.body(name, date, template.count(replies)),
      '',
      template.open,
      pageUrl,
      '',
      template.noNames,
      '',
      'EventSlide',
      '',
    ].join('\n'),
  }
}

/** The replies page of the event in the host's console, from the configured public origin. */
export const rsvpErasurePageUrl = (publicUrl: string, slug: string): string =>
  `${publicUrl}/admin/events/${encodeURIComponent(slug)}/rsvps`
