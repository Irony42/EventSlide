import type { ClientLocale } from '../clients/clientLocale'
import { toSingleLine } from '../shared/plainText'
import type { EmailAddress } from '../users/emailAddress'
import type { OutgoingMail } from './outgoingMail'

/**
 * The mail that tells a host what the operator did on their account or event (spec 32, A4): a photograph, a guestbook message or
 * an event taken down, a client suspended, resumed or put on the way out.
 *
 * - **The event's name only** (or the space's, for an act on a client): never a guest's name, never the content that was removed,
 *   never an address of the photograph. "A photograph of the event X", nothing more.
 * - **The operator's reason for the host**, typed in a field of its own (not the audit reason), when there is one.
 * - **No link** (nothing to click: the host is told, not led somewhere). That promise covers **what the code adds**: the reason for
 *   the host is free text the operator typed, and a link or an address typed in it is carried as typed. How to contest it: answer this mail when the operator's
 *   contact address is configured (it is the `replyTo`), else write to the operator of the server.
 * - The day of the act is spelt in UTC, like the purge notices.
 * - Lifting a suspension is good news: it carries no "contest" sentence.
 *
 * Pure: a function of its arguments.
 */

export const TAKEDOWN_KINDS = [
  'photo',
  'guestbook',
  'event',
  'clientSuspended',
  'clientResumed',
  'clientOffboarded',
] as const

export type TakedownKind = (typeof TAKEDOWN_KINDS)[number]

interface Words {
  readonly greeting: string
  readonly photo: (name: string) => string
  readonly guestbook: (name: string) => string
  readonly event: (name: string) => string
  readonly suspended: (name: string) => string
  readonly resumed: (name: string) => string
  readonly offboarded: (name: string) => string
  /** The short subject of each kind: a name is host-written and long, the sentence is not a subject. */
  readonly subject: Readonly<Record<TakedownKind, (name: string) => string>>
  readonly on: (date: string) => string
  readonly purgeOn: (date: string) => string
  readonly reason: string
  readonly contestByReply: string
  readonly contestByWriting: string
}

const NBSP = String.fromCharCode(160)

const WORDS: Readonly<Record<ClientLocale, Words>> = {
  fr: {
    subject: {
      photo: (n) => `Une photo a été retirée de «${NBSP}${n}${NBSP}»`,
      guestbook: (n) => `Un message a été retiré de «${NBSP}${n}${NBSP}»`,
      event: (n) => `L’évènement «${NBSP}${n}${NBSP}» a été retiré`,
      clientSuspended: (n) => `L’espace «${NBSP}${n}${NBSP}» est suspendu`,
      clientResumed: (n) => `L’espace «${NBSP}${n}${NBSP}» est rétabli`,
      clientOffboarded: (n) => `L’espace «${NBSP}${n}${NBSP}» est clos`,
    },
    greeting: 'Bonjour,',
    photo: (name) =>
      `Une photo de l’évènement «${NBSP}${name}${NBSP}» a été retirée par l’opérateur de ce serveur.`,
    guestbook: (name) =>
      `Un message du livre d’or de l’évènement «${NBSP}${name}${NBSP}» a été retiré par l’opérateur de ce serveur.`,
    event: (name) =>
      `L’évènement «${NBSP}${name}${NBSP}» a été retiré par l’opérateur de ce serveur${NBSP}: il n’est plus accessible.`,
    suspended: (name) =>
      `L’espace «${NBSP}${name}${NBSP}» a été suspendu par l’opérateur de ce serveur${NBSP}: vos invités n’y accèdent plus et vous pouvez le lire sans le modifier.`,
    resumed: (name) =>
      `La suspension de l’espace «${NBSP}${name}${NBSP}» a été levée${NBSP}: tout fonctionne de nouveau.`,
    offboarded: (name) =>
      `L’espace «${NBSP}${name}${NBSP}» est clos par l’opérateur de ce serveur${NBSP}: vos évènements en cours sont terminés.`,
    on: (date) => `Le ${date}.`,
    purgeOn: (date) =>
      `Vos albums seront supprimés le ${date}. Téléchargez ce que vous voulez garder avant cette date.`,
    reason: `Motif${NBSP}:`,
    contestByReply: 'Pour contester cette décision, répondez à ce message.',
    contestByWriting: 'Pour contester cette décision, écrivez à l’opérateur de ce serveur.',
  },
  en: {
    subject: {
      photo: (n) => `A photo was removed from "${n}"`,
      guestbook: (n) => `A message was removed from "${n}"`,
      event: (n) => `The event "${n}" was taken down`,
      clientSuspended: (n) => `The space "${n}" is suspended`,
      clientResumed: (n) => `The space "${n}" is restored`,
      clientOffboarded: (n) => `The space "${n}" is closed`,
    },
    greeting: 'Hello,',
    photo: (name) => `A photo of the event "${name}" was removed by this server's operator.`,
    guestbook: (name) =>
      `A guestbook message of the event "${name}" was removed by this server's operator.`,
    event: (name) =>
      `The event "${name}" was taken down by this server's operator: it can no longer be reached.`,
    suspended: (name) =>
      `The space "${name}" was suspended by this server's operator: your guests can no longer reach it and you can read it but not change it.`,
    resumed: (name) => `The suspension of the space "${name}" was lifted: everything works again.`,
    offboarded: (name) =>
      `The space "${name}" was closed by this server's operator: your running events are over.`,
    on: (date) => `On ${date}.`,
    purgeOn: (date) =>
      `Your albums will be deleted on ${date}. Download what you want to keep before then.`,
    reason: 'Reason:',
    contestByReply: 'To contest this decision, reply to this message.',
    contestByWriting: 'To contest this decision, write to the operator of this server.',
  },
  de: {
    subject: {
      photo: (n) => `Ein Foto wurde aus „${n}“ entfernt`,
      guestbook: (n) => `Eine Nachricht wurde aus „${n}“ entfernt`,
      event: (n) => `Die Veranstaltung „${n}“ wurde entfernt`,
      clientSuspended: (n) => `Der Bereich „${n}“ ist gesperrt`,
      clientResumed: (n) => `Der Bereich „${n}“ ist wieder freigegeben`,
      clientOffboarded: (n) => `Der Bereich „${n}“ ist beendet`,
    },
    greeting: 'Guten Tag,',
    photo: (name) =>
      `Ein Foto der Veranstaltung „${name}“ wurde vom Betreiber dieses Servers entfernt.`,
    guestbook: (name) =>
      `Eine Gästebuch-Nachricht der Veranstaltung „${name}“ wurde vom Betreiber dieses Servers entfernt.`,
    event: (name) =>
      `Die Veranstaltung „${name}“ wurde vom Betreiber dieses Servers entfernt: sie ist nicht mehr erreichbar.`,
    suspended: (name) =>
      `Der Bereich „${name}“ wurde vom Betreiber dieses Servers gesperrt: Ihre Gäste erreichen ihn nicht mehr, Sie können ihn lesen, aber nicht ändern.`,
    resumed: (name) =>
      `Die Sperre des Bereichs „${name}“ wurde aufgehoben: alles funktioniert wieder.`,
    offboarded: (name) =>
      `Der Bereich „${name}“ wurde vom Betreiber dieses Servers beendet: Ihre laufenden Veranstaltungen sind abgeschlossen.`,
    on: (date) => `Am ${date}.`,
    purgeOn: (date) =>
      `Ihre Alben werden am ${date} gelöscht. Laden Sie vorher herunter, was Sie behalten möchten.`,
    reason: 'Grund:',
    contestByReply: 'Um diese Entscheidung anzufechten, antworten Sie auf diese Nachricht.',
    contestByWriting:
      'Um diese Entscheidung anzufechten, schreiben Sie an den Betreiber dieses Servers.',
  },
  es: {
    subject: {
      photo: (n) => `Se retiró una foto de «${n}»`,
      guestbook: (n) => `Se retiró un mensaje de «${n}»`,
      event: (n) => `Se retiró el evento «${n}»`,
      clientSuspended: (n) => `El espacio «${n}» está suspendido`,
      clientResumed: (n) => `El espacio «${n}» se ha restablecido`,
      clientOffboarded: (n) => `El espacio «${n}» está cerrado`,
    },
    greeting: 'Hola,',
    photo: (name) => `El operador de este servidor ha retirado una foto del evento «${name}».`,
    guestbook: (name) =>
      `El operador de este servidor ha retirado un mensaje del libro de visitas del evento «${name}».`,
    event: (name) =>
      `El operador de este servidor ha retirado el evento «${name}»: ya no es accesible.`,
    suspended: (name) =>
      `El operador de este servidor ha suspendido el espacio «${name}»: sus invitados ya no acceden a él y usted puede leerlo pero no modificarlo.`,
    resumed: (name) =>
      `Se ha levantado la suspensión del espacio «${name}»: todo funciona de nuevo.`,
    offboarded: (name) =>
      `El operador de este servidor ha cerrado el espacio «${name}»: sus eventos en curso han terminado.`,
    on: (date) => `El ${date}.`,
    purgeOn: (date) =>
      `Sus álbumes se eliminarán el ${date}. Descargue lo que quiera conservar antes de esa fecha.`,
    reason: 'Motivo:',
    contestByReply: 'Para impugnar esta decisión, responda a este mensaje.',
    contestByWriting: 'Para impugnar esta decisión, escriba al operador de este servidor.',
  },
  it: {
    subject: {
      photo: (n) => `Una foto è stata rimossa da «${n}»`,
      guestbook: (n) => `Un messaggio è stato rimosso da «${n}»`,
      event: (n) => `L’evento «${n}» è stato rimosso`,
      clientSuspended: (n) => `Lo spazio «${n}» è sospeso`,
      clientResumed: (n) => `Lo spazio «${n}» è ripristinato`,
      clientOffboarded: (n) => `Lo spazio «${n}» è chiuso`,
    },
    greeting: 'Buongiorno,',
    photo: (name) => `L’operatore di questo server ha rimosso una foto dell’evento «${name}».`,
    guestbook: (name) =>
      `L’operatore di questo server ha rimosso un messaggio del libro degli ospiti dell’evento «${name}».`,
    event: (name) =>
      `L’operatore di questo server ha rimosso l’evento «${name}»: non è più raggiungibile.`,
    suspended: (name) =>
      `L’operatore di questo server ha sospeso lo spazio «${name}»: i suoi ospiti non vi accedono più e lei può leggerlo ma non modificarlo.`,
    resumed: (name) =>
      `La sospensione dello spazio «${name}» è stata revocata: tutto funziona di nuovo.`,
    offboarded: (name) =>
      `L’operatore di questo server ha chiuso lo spazio «${name}»: i suoi eventi in corso sono terminati.`,
    on: (date) => `Il ${date}.`,
    purgeOn: (date) =>
      `I suoi album verranno eliminati il ${date}. Scarichi ciò che vuole conservare prima di quella data.`,
    reason: 'Motivo:',
    contestByReply: 'Per contestare questa decisione, risponda a questo messaggio.',
    contestByWriting: 'Per contestare questa decisione, scriva all’operatore di questo server.',
  },
}

const dayIn = (locale: ClientLocale, at: Date): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(at)

export interface TakedownMailInput {
  readonly to: EmailAddress
  readonly locale: ClientLocale
  readonly kind: TakedownKind
  /** The event's name for a removal, the space's name for an act on a client: host-written, folded to one line here. */
  readonly name: string
  readonly at: Date
  /** The operator's reason for the host, already folded by `parseHostReason`, or `null`. */
  readonly reason: string | null
  /** The operator's contact address when it is configured: where a reply goes. */
  readonly replyTo: EmailAddress | null
  /** For an offboarding: the day the albums are deleted. */
  readonly purgeAt?: Date | null
}

export const takedownMail = ({
  to,
  locale,
  kind,
  name,
  at,
  reason,
  replyTo,
  purgeAt = null,
}: TakedownMailInput): OutgoingMail => {
  const words = WORDS[locale]
  const label = toSingleLine(name)
  const sentence = {
    photo: words.photo,
    guestbook: words.guestbook,
    event: words.event,
    clientSuspended: words.suspended,
    clientResumed: words.resumed,
    clientOffboarded: words.offboarded,
  }[kind](label)
  const lines = [sentence, words.on(dayIn(locale, at))]
  if (kind === 'clientOffboarded' && purgeAt !== null)
    lines.push(words.purgeOn(dayIn(locale, purgeAt)))
  if (reason !== null) lines.push(`${words.reason} ${reason}`)
  if (kind !== 'clientResumed') {
    lines.push(replyTo === null ? words.contestByWriting : words.contestByReply)
  }
  const mail: OutgoingMail = {
    to,
    subject: words.subject[kind](label),
    text: [words.greeting, '', ...lines, '', 'EventSlide', ''].join('\n'),
    ...(replyTo === null ? {} : { replyTo }),
  }
  return mail
}
