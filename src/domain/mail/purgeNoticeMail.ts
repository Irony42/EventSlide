import type { ClientLocale } from '../clients/clientLocale'
import type { EmailAddress } from '../users/emailAddress'
import type { OutgoingMail } from './outgoingMail'
import { toSingleLine } from '../shared/plainText'

/**
 * The message that tells an event's owners their album will be deleted (spec 22): three times,
 * 14, 3 and 1 day before, in the five languages the product speaks.
 *
 * **A convenience, never the way the host finds out.** The page of the event shows the date
 * all the time; this is the nudge for the host who is not looking. So it is short and says only
 * what is needed to act: the album, the date, where to download it.
 *
 * - **Nothing of the album is in it**: no photograph, no caption, no guest's first name. The
 *   event's name is the one the host typed, sent to the host, folded to one line like every
 *   name that goes into a header (`toSingleLine`). The last line of the body says so.
 * - **The date is a day in UTC**, spelt by the language, because the retention counts in UTC days
 *   (`MS_PER_DAY`) and a message that named the reader's timezone would have to know it.
 * - Plain text only, one address on a line of its own: nothing to click that is not the page.
 *
 * Pure: a function of its arguments.
 */

export interface PurgeNoticeMailInput {
  readonly to: EmailAddress
  readonly locale: ClientLocale
  /** The album's name, as the host typed it. */
  readonly eventName: string
  /** When the album will be deleted. */
  readonly deleteAt: Date
  /** The event's page, absolute (`PUBLIC_URL` and its path). */
  readonly pageUrl: string
}

interface Template {
  readonly subject: (name: string, date: string) => string
  readonly greeting: string
  readonly body: (name: string, date: string) => string
  readonly open: string
  readonly noPhotos: string
}

const TEMPLATES: Readonly<Record<ClientLocale, Template>> = {
  fr: {
    subject: (name, date) => `Votre album « ${name} » sera supprimé le ${date}`,
    greeting: 'Bonjour,',
    body: (name, date) =>
      `Votre album « ${name} » sera supprimé le ${date}, comme annoncé à vos invités.`,
    open: 'Pour le télécharger avant, ouvrez :',
    noPhotos: 'Ce message ne contient aucune photo.',
  },
  en: {
    subject: (name, date) => `Your album "${name}" will be deleted on ${date}`,
    greeting: 'Hello,',
    body: (name, date) =>
      `Your album "${name}" will be deleted on ${date}, as announced to your guests.`,
    open: 'To download it before then, open:',
    noPhotos: 'This message contains no photos.',
  },
  de: {
    subject: (name, date) => `Ihr Album „${name}“ wird am ${date} gelöscht`,
    greeting: 'Guten Tag,',
    body: (name, date) =>
      `Ihr Album „${name}“ wird am ${date} gelöscht, wie es Ihren Gästen angekündigt wurde.`,
    open: 'Um es vorher herunterzuladen, öffnen Sie:',
    noPhotos: 'Diese Nachricht enthält keine Fotos.',
  },
  es: {
    subject: (name, date) => `Su álbum «${name}» se eliminará el ${date}`,
    greeting: 'Hola,',
    body: (name, date) =>
      `Su álbum «${name}» se eliminará el ${date}, como se anunció a sus invitados.`,
    open: 'Para descargarlo antes, abra:',
    noPhotos: 'Este mensaje no contiene ninguna foto.',
  },
  it: {
    subject: (name, date) => `Il suo album «${name}» verrà eliminato il ${date}`,
    greeting: 'Buongiorno,',
    body: (name, date) =>
      `Il suo album «${name}» verrà eliminato il ${date}, come annunciato ai suoi ospiti.`,
    open: 'Per scaricarlo prima, apra:',
    noPhotos: 'Questo messaggio non contiene alcuna foto.',
  },
}

const dateIn = (locale: ClientLocale, at: Date): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(at)

export const purgeNoticeMail = ({
  to,
  locale,
  eventName,
  deleteAt,
  pageUrl,
}: PurgeNoticeMailInput): OutgoingMail => {
  const template = TEMPLATES[locale]
  const name = toSingleLine(eventName)
  const date = dateIn(locale, deleteAt)

  return {
    to,
    subject: template.subject(name, date),
    text: [
      template.greeting,
      '',
      template.body(name, date),
      '',
      template.open,
      pageUrl,
      '',
      template.noPhotos,
      '',
      'EventSlide',
      '',
    ].join('\n'),
  }
}

/** The address of the event's page in the host's console, from the configured public origin. */
export const purgeNoticePageUrl = (publicUrl: string, slug: string): string =>
  `${publicUrl}/admin/events/${encodeURIComponent(slug)}`
