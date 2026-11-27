import type { ClientLocale } from '../clients/clientLocale'
import type { RsvpFigures } from '../notices/rsvpFigures'
import { toSingleLine } from '../shared/plainText'
import type { EmailAddress } from '../users/emailAddress'
import type { OutgoingMail } from './outgoingMail'

/**
 * R2 to R5 (spec 32, section 3.1): the notices of the replies' family. **Figures only** (`RsvpFigures`, a projection
 * with no nominative field), the host's own menu labels, the event's name folded to one line, **one link**, and a last
 * line, without a link, saying where the family is switched off. Plain text, five languages.
 *
 * - R2, the daily summary an owner ticked for an event;
 * - R3, three days before the replies' deadline, while households have not answered;
 * - R4, the summary once the deadline stopped the replies;
 * - R5, every place is taken.
 *
 * Pure: a function of its arguments.
 */

/** A real no-break space, for the French spacing before `:` `;` and inside « ». */
const NBSP = String.fromCharCode(160)

interface Words {
  readonly greeting: string
  readonly yes: string
  readonly maybe: string
  readonly no: string
  readonly waitlist: string
  readonly adults: (n: number) => string
  readonly kids: (n: number) => string
  readonly unanswered: (n: number) => string
  readonly diets: (n: number) => string
  readonly menus: string
  readonly overall: string
  readonly changed: (n: number) => string
  readonly digestSubject: (name: string, n: number) => string
  readonly deadlineSubject: (name: string) => string
  readonly deadlineBody: (name: string, unanswered: string, date: string) => string
  readonly stoppedSubject: (name: string) => string
  readonly stoppedBody: (name: string) => string
  readonly fullSubject: (name: string) => string
  readonly fullBody: (capacity: number) => string
  readonly open: string
  readonly openUnanswered: string
  readonly footer: string
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

const WORDS: Readonly<Record<ClientLocale, Words>> = {
  fr: {
    greeting: 'Bonjour,',
    yes: 'oui',
    maybe: 'peut-être',
    no: 'non',
    waitlist: 'en liste d’attente',
    adults: (n) => `${n} ${n > 1 ? 'adultes' : 'adulte'}`,
    kids: (n) => `${n} ${n > 1 ? 'enfants' : 'enfant'}`,
    unanswered: (n) => `${n} ${n > 1 ? 'foyers' : 'foyer'} sans réponse`,
    diets: (n) => `${n} ${n > 1 ? 'régimes signalés' : 'régime signalé'}`,
    menus: `Menus${NBSP}:`,
    overall: `En tout${NBSP}:`,
    changed: (n) => `${n} ${n > 1 ? 'réponses nouvelles ou modifiées' : 'réponse nouvelle ou modifiée'}.`,
    digestSubject: (name, n) =>
      `${n} ${n > 1 ? 'réponses' : 'réponse'} de plus pour «${NBSP}${name}${NBSP}»`,
    deadlineSubject: (name) => `Réponses à «${NBSP}${name}${NBSP}»${NBSP}: la date limite approche`,
    deadlineBody: (name, unanswered, date) =>
      `${unanswered} pour «${NBSP}${name}${NBSP}»${NBSP}; la date limite est le ${date}.`,
    stoppedSubject: (name) => `Les réponses à «${NBSP}${name}${NBSP}» sont closes`,
    stoppedBody: (name) =>
      `La date limite est passée, les réponses à «${NBSP}${name}${NBSP}» sont closes. Le bilan${NBSP}:`,
    fullSubject: (name) => `«${NBSP}${name}${NBSP}»${NBSP}: complet`,
    fullBody: (capacity) =>
      `Les ${capacity} places sont prises${NBSP}; les nouvelles réponses vont en liste d’attente.`,
    open: `Les réponses${NBSP}:`,
    openUnanswered: `Les foyers sans réponse${NBSP}:`,
    footer: `Pour ne plus recevoir ces e-mails${NBSP}: menu du compte, Sécurité et e-mails.`,
  },
  en: {
    greeting: 'Hello,',
    yes: 'yes',
    maybe: 'maybe',
    no: 'no',
    waitlist: 'on the waiting list',
    adults: (n) => `${n} ${plural(n, 'adult', 'adults')}`,
    kids: (n) => `${n} ${plural(n, 'child', 'children')}`,
    unanswered: (n) => `${n} ${plural(n, 'household', 'households')} with no reply`,
    diets: (n) => `${n} ${plural(n, 'diet', 'diets')} reported`,
    menus: 'Menus:',
    overall: 'In all:',
    changed: (n) => `${n} new or changed ${plural(n, 'reply', 'replies')}.`,
    digestSubject: (name, n) => `${n} more ${plural(n, 'reply', 'replies')} for "${name}"`,
    deadlineSubject: (name) => `Replies to "${name}": the deadline is close`,
    deadlineBody: (name, unanswered, date) => `${unanswered} for "${name}"; the deadline is ${date}.`,
    stoppedSubject: (name) => `Replies to "${name}" are closed`,
    stoppedBody: (name) => `The deadline has passed and replies to "${name}" are closed. The summary:`,
    fullSubject: (name) => `"${name}": full`,
    fullBody: (capacity) => `All ${capacity} places are taken; new replies go on the waiting list.`,
    open: 'The replies:',
    openUnanswered: 'The households with no reply:',
    footer: 'To stop receiving these e-mails: account menu, Security and e-mails.',
  },
  de: {
    greeting: 'Guten Tag,',
    yes: 'Ja',
    maybe: 'Vielleicht',
    no: 'Nein',
    waitlist: 'auf der Warteliste',
    adults: (n) => `${n} ${plural(n, 'Erwachsener', 'Erwachsene')}`,
    kids: (n) => `${n} ${plural(n, 'Kind', 'Kinder')}`,
    unanswered: (n) => `${n} ${plural(n, 'Haushalt', 'Haushalte')} ohne Antwort`,
    diets: (n) => `${n} ${plural(n, 'Ernährungshinweis', 'Ernährungshinweise')}`,
    menus: 'Menüs:',
    overall: 'Insgesamt:',
    changed: (n) => `${n} ${plural(n, 'neue oder geänderte Antwort', 'neue oder geänderte Antworten')}.`,
    digestSubject: (name, n) => `${n} ${plural(n, 'Antwort', 'Antworten')} mehr zu „${name}“`,
    deadlineSubject: (name) => `Antworten zu „${name}“: die Frist rückt näher`,
    deadlineBody: (name, unanswered, date) => `${unanswered} zu „${name}“; die Frist ist der ${date}.`,
    stoppedSubject: (name) => `Die Antworten zu „${name}“ sind geschlossen`,
    stoppedBody: (name) =>
      `Die Frist ist abgelaufen, die Antworten zu „${name}“ sind geschlossen. Die Bilanz:`,
    fullSubject: (name) => `„${name}“: ausgebucht`,
    fullBody: (capacity) =>
      `Alle ${capacity} Plätze sind vergeben; neue Antworten kommen auf die Warteliste.`,
    open: 'Die Antworten:',
    openUnanswered: 'Die Haushalte ohne Antwort:',
    footer: 'Um diese E-Mails nicht mehr zu erhalten: Kontomenü, Sicherheit und E-Mails.',
  },
  es: {
    greeting: 'Hola,',
    yes: 'sí',
    maybe: 'quizá',
    no: 'no',
    waitlist: 'en lista de espera',
    adults: (n) => `${n} ${plural(n, 'adulto', 'adultos')}`,
    kids: (n) => `${n} ${plural(n, 'niño', 'niños')}`,
    unanswered: (n) => `${n} ${plural(n, 'hogar', 'hogares')} sin respuesta`,
    diets: (n) => `${n} ${plural(n, 'dieta indicada', 'dietas indicadas')}`,
    menus: 'Menús:',
    overall: 'En total:',
    changed: (n) =>
      `${n} ${plural(n, 'respuesta nueva o modificada', 'respuestas nuevas o modificadas')}.`,
    digestSubject: (name, n) => `${n} ${plural(n, 'respuesta más', 'respuestas más')} para «${name}»`,
    deadlineSubject: (name) => `Respuestas a «${name}»: se acerca la fecha límite`,
    deadlineBody: (name, unanswered, date) =>
      `${unanswered} para «${name}»; la fecha límite es el ${date}.`,
    stoppedSubject: (name) => `Las respuestas a «${name}» están cerradas`,
    stoppedBody: (name) =>
      `Ha pasado la fecha límite y las respuestas a «${name}» están cerradas. El balance:`,
    fullSubject: (name) => `«${name}»: completo`,
    fullBody: (capacity) =>
      `Las ${capacity} plazas están ocupadas; las nuevas respuestas van a la lista de espera.`,
    open: 'Las respuestas:',
    openUnanswered: 'Los hogares sin respuesta:',
    footer: 'Para no recibir estos correos: menú de la cuenta, Seguridad y correos.',
  },
  it: {
    greeting: 'Buongiorno,',
    yes: 'sì',
    maybe: 'forse',
    no: 'no',
    waitlist: 'in lista d’attesa',
    adults: (n) => `${n} ${plural(n, 'adulto', 'adulti')}`,
    kids: (n) => `${n} ${plural(n, 'bambino', 'bambini')}`,
    unanswered: (n) => `${n} ${plural(n, 'nucleo', 'nuclei')} senza risposta`,
    diets: (n) => `${n} ${plural(n, 'dieta segnalata', 'diete segnalate')}`,
    menus: 'Menu:',
    overall: 'In totale:',
    changed: (n) => `${n} ${plural(n, 'risposta nuova o modificata', 'risposte nuove o modificate')}.`,
    digestSubject: (name, n) => `${n} ${plural(n, 'risposta in più', 'risposte in più')} per «${name}»`,
    deadlineSubject: (name) => `Risposte a «${name}»: la scadenza si avvicina`,
    deadlineBody: (name, unanswered, date) => `${unanswered} per «${name}»; la scadenza è il ${date}.`,
    stoppedSubject: (name) => `Le risposte a «${name}» sono chiuse`,
    stoppedBody: (name) => `La scadenza è passata e le risposte a «${name}» sono chiuse. Il riepilogo:`,
    fullSubject: (name) => `«${name}»: al completo`,
    fullBody: (capacity) =>
      `Tutti i ${capacity} posti sono occupati; le nuove risposte vanno in lista d’attesa.`,
    open: 'Le risposte:',
    openUnanswered: 'I nuclei senza risposta:',
    footer: 'Per non ricevere più queste e-mail: menu dell’account, Sicurezza ed e-mail.',
  },
}

/** "31 yes (24 adults, 7 children), 2 maybe, 6 no, 3 on the waiting list": the figures and nothing of a guest. */
const figuresLine = (words: Words, figures: RsvpFigures): string =>
  [
    `${figures.yes.people} ${words.yes} (${words.adults(figures.yes.adults)}, ${words.kids(figures.yes.kids)})`,
    `${figures.maybe.responses} ${words.maybe}`,
    `${figures.no.responses} ${words.no}`,
    `${figures.waitlist.responses} ${words.waitlist}`,
  ].join(', ')

const dayIn = (locale: ClientLocale, at: Date): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(at)

const mailOf = (
  to: EmailAddress,
  subject: string,
  lines: readonly string[],
  words: Words,
): OutgoingMail => ({
  to,
  subject,
  text: [words.greeting, '', ...lines, '', words.footer, '', 'EventSlide', ''].join('\n'),
})

export interface RsvpFamilyMailBase {
  readonly to: EmailAddress
  readonly locale: ClientLocale
  /** The event's name, as the host typed it. */
  readonly eventName: string
  /** The page the mail points at, absolute. */
  readonly pageUrl: string
}

/** R2, the daily summary. `changed` is how many replies are new or changed since the host looked. */
export const rsvpDigestMail = ({
  to,
  locale,
  eventName,
  pageUrl,
  changed,
  figures,
}: RsvpFamilyMailBase & {
  readonly changed: number
  readonly figures: RsvpFigures
}): OutgoingMail => {
  const words = WORDS[locale]
  const total = `${words.overall} ${figuresLine(words, figures)}`
  const lines = [
    words.changed(changed),
    figures.noReplyHouseholds > 0
      ? `${total}; ${words.unanswered(figures.noReplyHouseholds)}.`
      : `${total}.`,
    '',
    words.open,
    pageUrl,
  ]
  return mailOf(to, words.digestSubject(toSingleLine(eventName), changed), lines, words)
}

/** R3, three days before the deadline. `deadline` is the day the host typed (`YYYY-MM-DD`). */
export const rsvpDeadlineMail = ({
  to,
  locale,
  eventName,
  pageUrl,
  unanswered,
  deadline,
}: RsvpFamilyMailBase & {
  readonly unanswered: number
  readonly deadline: string
}): OutgoingMail => {
  const words = WORDS[locale]
  const name = toSingleLine(eventName)
  const day = dayIn(locale, new Date(`${deadline}T00:00:00.000Z`))
  return mailOf(
    to,
    words.deadlineSubject(name),
    [
      words.deadlineBody(name, words.unanswered(unanswered), day),
      '',
      words.openUnanswered,
      pageUrl,
    ],
    words,
  )
}

/** R4, the summary once the deadline stopped the replies. */
export const rsvpStoppedMail = ({
  to,
  locale,
  eventName,
  pageUrl,
  figures,
}: RsvpFamilyMailBase & { readonly figures: RsvpFigures }): OutgoingMail => {
  const words = WORDS[locale]
  const name = toSingleLine(eventName)
  const lines = [words.stoppedBody(name), '', `${figuresLine(words, figures)}.`]
  if (figures.meals.length > 0) {
    const menus = figures.meals
      .map((meal) => `${toSingleLine(meal.label)} (${meal.count})`)
      .join(', ')
    lines.push(`${words.menus} ${menus}.`)
  }
  if (figures.dietCount > 0) lines.push(`${words.diets(figures.dietCount)}.`)
  if (figures.noReplyHouseholds > 0) lines.push(`${words.unanswered(figures.noReplyHouseholds)}.`)
  lines.push('', words.open, pageUrl)
  return mailOf(to, words.stoppedSubject(name), lines, words)
}

/** R5, every place is taken. */
export const rsvpFullMail = ({
  to,
  locale,
  eventName,
  pageUrl,
  capacity,
}: RsvpFamilyMailBase & { readonly capacity: number }): OutgoingMail => {
  const words = WORDS[locale]
  return mailOf(
    to,
    words.fullSubject(toSingleLine(eventName)),
    [words.fullBody(capacity), '', words.open, pageUrl],
    words,
  )
}

/** The guest list filtered on the households that have not answered (R3's link). */
export const rsvpUnansweredPageUrl = (publicUrl: string, slug: string): string =>
  `${publicUrl}/admin/events/${encodeURIComponent(slug)}/rsvps/guests?filter=unanswered`
