import type { ClientLocale } from '../clients/clientLocale'
import { toSingleLine } from '../shared/plainText'
import type { EmailAddress } from '../users/emailAddress'
import type { OutgoingMail } from './outgoingMail'

/**
 * The mails about the life of an event (spec 32, section 3.3, family `event`):
 *
 * - **A2**, a long job is over: the archive, the photo book or the highlight film is ready, or could not be made;
 * - **A3**, after the party: the event is closed, with the figures of what was published and where the album goes;
 * - **A5**, the wall closes within a day (the end of the space's opening time);
 * - **A6**, somebody accepted the invitation to co-organise or moderate the event.
 *
 * Plain text, five languages, **one link**, and a last line without a link saying where the family is switched off. Figures,
 * the event's name (folded to one line) and, for A6, the name the person gave themselves or the address the inviter typed:
 * never the content of an album.
 *
 * Pure: a function of its arguments.
 */

/** A real no-break space, for the French spacing before `:` `;` and inside « ». */
const NBSP = String.fromCharCode(160)

export type JobKind = 'archive' | 'book' | 'reel'
export type JobOutcome = 'done' | 'failed'
export type InvitedRole = 'moderator'

interface Words {
  readonly greeting: string
  readonly job: Readonly<
    Record<
      JobKind,
      { readonly done: (name: string) => string; readonly failed: (name: string) => string }
    >
  >
  readonly closedLead: (name: string) => string
  readonly photos: (n: number) => string
  readonly videos: (n: number) => string
  readonly messages: (n: number) => string
  readonly closedTail: string
  readonly deleteOn: (date: string) => string
  readonly windowSubject: (name: string) => string
  readonly windowBody: (name: string, date: string) => string
  readonly accepted: Readonly<Record<InvitedRole, (who: string, name: string) => string>>
  readonly acceptedSubject: (name: string) => string
  readonly open: string
  readonly footer: string
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

const WORDS: Readonly<Record<ClientLocale, Words>> = {
  fr: {
    greeting: 'Bonjour,',
    job: {
      archive: {
        done: (name) => `L’archive de «${NBSP}${name}${NBSP}» est prête.`,
        failed: (name) =>
          `L’archive de «${NBSP}${name}${NBSP}» n’a pas pu être faite${NBSP}; réessayez depuis la page.`,
      },
      book: {
        done: (name) => `Le livre photo de «${NBSP}${name}${NBSP}» est prêt.`,
        failed: (name) =>
          `Le livre photo de «${NBSP}${name}${NBSP}» n’a pas pu être fait${NBSP}; réessayez depuis la page.`,
      },
      reel: {
        done: (name) => `Le film des temps forts de «${NBSP}${name}${NBSP}» est prêt.`,
        failed: (name) =>
          `Le film des temps forts de «${NBSP}${name}${NBSP}» n’a pas pu être fait${NBSP}; réessayez depuis la page.`,
      },
    },
    closedLead: (name) => `«${NBSP}${name}${NBSP}» est terminé`,
    photos: (n) => `${n} ${plural(n, 'photo', 'photos')}`,
    videos: (n) => `${n} ${plural(n, 'vidéo', 'vidéos')}`,
    messages: (n) => `${n} ${plural(n, 'message', 'messages')} au livre d’or`,
    closedTail: 'L’album, le livre photo et le film sont dans la console.',
    deleteOn: (date) => `L’album sera supprimé le ${date}.`,
    windowSubject: (name) => `Le mur de «${NBSP}${name}${NBSP}» se ferme bientôt`,
    windowBody: (name, date) =>
      `Le mur de «${NBSP}${name}${NBSP}» se fermera le ${date} (fin de la durée d’ouverture de votre espace). Les invités ne pourront plus envoyer de photos${NBSP}; l’album reste.`,
    accepted: {
      moderator: (who, name) => `${who} a accepté de modérer «${NBSP}${name}${NBSP}».`,
    },
    acceptedSubject: (name) => `Une invitation a été acceptée pour «${NBSP}${name}${NBSP}»`,
    open: `La console${NBSP}:`,
    footer: `Pour ne plus recevoir ces e-mails${NBSP}: menu du compte, Sécurité et e-mails.`,
  },
  en: {
    greeting: 'Hello,',
    job: {
      archive: {
        done: (name) => `The archive of "${name}" is ready.`,
        failed: (name) => `The archive of "${name}" could not be made; try again from the page.`,
      },
      book: {
        done: (name) => `The photo book of "${name}" is ready.`,
        failed: (name) => `The photo book of "${name}" could not be made; try again from the page.`,
      },
      reel: {
        done: (name) => `The highlight film of "${name}" is ready.`,
        failed: (name) =>
          `The highlight film of "${name}" could not be made; try again from the page.`,
      },
    },
    closedLead: (name) => `"${name}" is over`,
    photos: (n) => `${n} ${plural(n, 'photo', 'photos')}`,
    videos: (n) => `${n} ${plural(n, 'video', 'videos')}`,
    messages: (n) => `${n} ${plural(n, 'message', 'messages')} in the guestbook`,
    closedTail: 'The album, the photo book and the film are in the console.',
    deleteOn: (date) => `The album will be deleted on ${date}.`,
    windowSubject: (name) => `The wall of "${name}" closes soon`,
    windowBody: (name, date) =>
      `The wall of "${name}" will close on ${date} (the end of your space's opening time). Guests will no longer be able to send photos; the album stays.`,
    accepted: {
      moderator: (who, name) => `${who} accepted to moderate "${name}".`,
    },
    acceptedSubject: (name) => `An invitation was accepted for "${name}"`,
    open: 'The console:',
    footer: 'To stop receiving these e-mails: account menu, Security and e-mails.',
  },
  de: {
    greeting: 'Guten Tag,',
    job: {
      archive: {
        done: (name) => `Das Archiv von „${name}“ ist fertig.`,
        failed: (name) =>
          `Das Archiv von „${name}“ konnte nicht erstellt werden; versuchen Sie es auf der Seite erneut.`,
      },
      book: {
        done: (name) => `Das Fotobuch von „${name}“ ist fertig.`,
        failed: (name) =>
          `Das Fotobuch von „${name}“ konnte nicht erstellt werden; versuchen Sie es auf der Seite erneut.`,
      },
      reel: {
        done: (name) => `Der Highlight-Film von „${name}“ ist fertig.`,
        failed: (name) =>
          `Der Highlight-Film von „${name}“ konnte nicht erstellt werden; versuchen Sie es auf der Seite erneut.`,
      },
    },
    closedLead: (name) => `„${name}“ ist vorbei`,
    photos: (n) => `${n} ${plural(n, 'Foto', 'Fotos')}`,
    videos: (n) => `${n} ${plural(n, 'Video', 'Videos')}`,
    messages: (n) => `${n} ${plural(n, 'Nachricht', 'Nachrichten')} im Gästebuch`,
    closedTail: 'Album, Fotobuch und Film finden Sie in der Konsole.',
    deleteOn: (date) => `Das Album wird am ${date} gelöscht.`,
    windowSubject: (name) => `Die Wand von „${name}“ schließt bald`,
    windowBody: (name, date) =>
      `Die Wand von „${name}“ schließt am ${date} (Ende der Öffnungsdauer Ihres Bereichs). Gäste können dann keine Fotos mehr senden; das Album bleibt.`,
    accepted: {
      moderator: (who, name) => `${who} hat zugesagt, „${name}“ zu moderieren.`,
    },
    acceptedSubject: (name) => `Eine Einladung zu „${name}“ wurde angenommen`,
    open: 'Die Konsole:',
    footer: 'Um diese E-Mails nicht mehr zu erhalten: Kontomenü, Sicherheit und E-Mails.',
  },
  es: {
    greeting: 'Hola,',
    job: {
      archive: {
        done: (name) => `El archivo de «${name}» está listo.`,
        failed: (name) =>
          `No se pudo crear el archivo de «${name}»; inténtelo de nuevo desde la página.`,
      },
      book: {
        done: (name) => `El libro de fotos de «${name}» está listo.`,
        failed: (name) =>
          `No se pudo crear el libro de fotos de «${name}»; inténtelo de nuevo desde la página.`,
      },
      reel: {
        done: (name) => `La película de los mejores momentos de «${name}» está lista.`,
        failed: (name) =>
          `No se pudo crear la película de «${name}»; inténtelo de nuevo desde la página.`,
      },
    },
    closedLead: (name) => `«${name}» ha terminado`,
    photos: (n) => `${n} ${plural(n, 'foto', 'fotos')}`,
    videos: (n) => `${n} ${plural(n, 'vídeo', 'vídeos')}`,
    messages: (n) => `${n} ${plural(n, 'mensaje', 'mensajes')} en el libro de visitas`,
    closedTail: 'El álbum, el libro de fotos y la película están en la consola.',
    deleteOn: (date) => `El álbum se eliminará el ${date}.`,
    windowSubject: (name) => `El muro de «${name}» se cierra pronto`,
    windowBody: (name, date) =>
      `El muro de «${name}» se cerrará el ${date} (fin de la duración de apertura de su espacio). Los invitados ya no podrán enviar fotos; el álbum se conserva.`,
    accepted: {
      moderator: (who, name) => `${who} aceptó moderar «${name}».`,
    },
    acceptedSubject: (name) => `Se aceptó una invitación para «${name}»`,
    open: 'La consola:',
    footer: 'Para no recibir estos correos: menú de la cuenta, Seguridad y correos.',
  },
  it: {
    greeting: 'Buongiorno,',
    job: {
      archive: {
        done: (name) => `L’archivio di «${name}» è pronto.`,
        failed: (name) =>
          `Non è stato possibile creare l’archivio di «${name}»; riprovi dalla pagina.`,
      },
      book: {
        done: (name) => `Il libro fotografico di «${name}» è pronto.`,
        failed: (name) =>
          `Non è stato possibile creare il libro fotografico di «${name}»; riprovi dalla pagina.`,
      },
      reel: {
        done: (name) => `Il film dei momenti migliori di «${name}» è pronto.`,
        failed: (name) =>
          `Non è stato possibile creare il film di «${name}»; riprovi dalla pagina.`,
      },
    },
    closedLead: (name) => `«${name}» è finito`,
    photos: (n) => `${n} ${plural(n, 'foto', 'foto')}`,
    videos: (n) => `${n} ${plural(n, 'video', 'video')}`,
    messages: (n) => `${n} ${plural(n, 'messaggio', 'messaggi')} nel libro degli ospiti`,
    closedTail: 'L’album, il libro fotografico e il film sono nella console.',
    deleteOn: (date) => `L’album verrà eliminato il ${date}.`,
    windowSubject: (name) => `Il muro di «${name}» chiude presto`,
    windowBody: (name, date) =>
      `Il muro di «${name}» chiuderà il ${date} (fine della durata di apertura del suo spazio). Gli ospiti non potranno più inviare foto; l’album resta.`,
    accepted: {
      moderator: (who, name) => `${who} ha accettato di moderare «${name}».`,
    },
    acceptedSubject: (name) => `Un invito per «${name}» è stato accettato`,
    open: 'La console:',
    footer: 'Per non ricevere più queste e-mail: menu dell’account, Sicurezza ed e-mail.',
  },
}

const dayIn = (locale: ClientLocale, at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(at)

const mailOf = (
  to: EmailAddress,
  subject: string,
  lines: readonly string[],
  pageUrl: string,
  words: Words,
): OutgoingMail => ({
  to,
  subject,
  text: [
    words.greeting,
    '',
    ...lines,
    '',
    words.open,
    pageUrl,
    '',
    words.footer,
    '',
    'EventSlide',
    '',
  ].join('\n'),
})

export interface EventMailBase {
  readonly to: EmailAddress
  readonly locale: ClientLocale
  /** The event's name, as the host typed it. */
  readonly eventName: string
  /** The page the mail points at, absolute. */
  readonly pageUrl: string
}

/** A2: the archive, the book or the film is ready, or could not be made. */
export const jobDoneMail = ({
  to,
  locale,
  eventName,
  pageUrl,
  job,
  outcome,
}: EventMailBase & { readonly job: JobKind; readonly outcome: JobOutcome }): OutgoingMail => {
  const words = WORDS[locale]
  const sentence = words.job[job][outcome](toSingleLine(eventName))
  return mailOf(to, sentence, [sentence], pageUrl, words)
}

/** A3: the party is over; what was published, and when the album goes (`null` when no deletion is planned). */
export const eventClosedMail = ({
  to,
  locale,
  eventName,
  pageUrl,
  photos,
  videos,
  messages,
  deleteAt,
}: EventMailBase & {
  readonly photos: number
  readonly videos: number
  readonly messages: number
  readonly deleteAt: Date | null
}): OutgoingMail => {
  const words = WORDS[locale]
  const name = toSingleLine(eventName)
  const parts = [
    photos > 0 ? words.photos(photos) : null,
    videos > 0 ? words.videos(videos) : null,
    messages > 0 ? words.messages(messages) : null,
  ].filter((part): part is string => part !== null)
  const lead = `${words.closedLead(name)}${locale === 'fr' ? NBSP : ''}: ${parts.join(', ')}.`
  const lines = [lead, words.closedTail]
  if (deleteAt !== null) lines.push(words.deleteOn(dayIn(locale, deleteAt, 'UTC')))
  return mailOf(to, words.closedLead(name), lines, pageUrl, words)
}

/** A5: the wall closes within a day. The day is read in `timeZone` (the invitation's, UTC without one). */
export const windowEndingMail = ({
  to,
  locale,
  eventName,
  pageUrl,
  endsAt,
  timeZone,
}: EventMailBase & { readonly endsAt: Date; readonly timeZone: string }): OutgoingMail => {
  const words = WORDS[locale]
  const name = toSingleLine(eventName)
  return mailOf(
    to,
    words.windowSubject(name),
    [words.windowBody(name, dayIn(locale, endsAt, timeZone))],
    pageUrl,
    words,
  )
}

/** A6: an invitation to co-organise or moderate was accepted. `who` is the name they gave, else the address typed. */
export const invitationAcceptedMail = ({
  to,
  locale,
  eventName,
  pageUrl,
  who,
  role,
}: EventMailBase & { readonly who: string; readonly role: InvitedRole }): OutgoingMail => {
  const words = WORDS[locale]
  const name = toSingleLine(eventName)
  return mailOf(
    to,
    words.acceptedSubject(name),
    [words.accepted[role](toSingleLine(who), name)],
    pageUrl,
    words,
  )
}

/**
 * Whether a name typed by a stranger holds anything that reads as a link (a scheme, `www.`, or a domain name): the mail names
 * the invited address instead, so it never carries a second link the sender chose.
 */
export const isUrlLike = (name: string): boolean =>
  /:\/\/|\bwww\.|\b[a-z0-9-]+\.[a-z]{2,}(?:\/|\b)/iu.test(name)

/** The event's page in the console, from the configured public origin. */
export const eventPageUrl = (publicUrl: string, slug: string, page = ''): string =>
  `${publicUrl}/admin/events/${encodeURIComponent(slug)}${page === '' ? '' : `/${page}`}`
