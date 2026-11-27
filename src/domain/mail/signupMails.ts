import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { ClientLocale } from '../clients/clientLocale'
import type { EmailAddress } from '../users/emailAddress'
import type { OutgoingMail } from './outgoingMail'

/**
 * The four messages self-service signup adds (spec 31 section 8, ADR 0018), in the five languages the
 * product speaks. Everything `invitationMail` and `passwordResetMail` argue applies: plain text only,
 * **one link** on a line of its own, no image, no tracking, no second URL, and no word about whether
 * the address already has an account (the confirmation is the same for every address, which is what
 * keeps the form from being an oracle).
 *
 * - {@link signupConfirmationMail}: to the visitor, a link to confirm the address (valid 24 hours).
 * - {@link signupRefusedMail}: to the visitor, when an operator refused and chose to say so. No reason.
 *   The one link is the self-hosting guide. Reply goes to the contact address.
 * - {@link signupOperatorNoticeMail}: to the operator, a count and a link to the console. It carries
 *   no address and no name: a mailbox is not where a stranger's data should travel.
 * - {@link welcomeMail}: to the first owner of a fresh client, three first steps. The one link is the
 *   guides; a question goes to the contact address, named in the text and set as the reply address.
 *
 * Pure: a function of its arguments.
 */

/** The no-break space French puts before : ; ! ? and inside « ». Built, so no editor shows it as a plain space. */
const NBSP = String.fromCodePoint(0xa0)

const HELLO: Readonly<Record<ClientLocale, string>> = {
  fr: 'Bonjour,',
  en: 'Hello,',
  de: 'Guten Tag,',
  es: 'Hola,',
  it: 'Buongiorno,',
}

/* ------------------------------------------------------------------------------------------------ */

export interface SignupConfirmationMailInput {
  readonly to: EmailAddress
  readonly locale: ClientLocale
  /** The absolute URL carrying the token. */
  readonly link: string
  /** How long the link works, in whole hours. */
  readonly lifetimeHours: number
}

interface ConfirmationTemplate {
  readonly subject: string
  readonly intro: string
  readonly open: (hours: number) => string
  readonly ignore: string
}

const CONFIRMATION: Readonly<Record<ClientLocale, ConfirmationTemplate>> = {
  fr: {
    subject: 'Confirmez votre adresse pour créer votre compte EventSlide',
    intro: 'Quelqu’un a demandé la création d’un compte EventSlide avec cette adresse.',
    open: (hours) =>
      hours === 1
        ? `Pour confirmer que c’est bien vous, ouvrez ce lien dans l’heure qui vient${NBSP}:`
        : `Pour confirmer que c’est bien vous, ouvrez ce lien dans les ${hours} heures qui viennent${NBSP}:`,
    ignore: `Vous n’avez rien demandé${NBSP}? Ignorez ce message, rien ne sera créé.`,
  },
  en: {
    subject: 'Confirm your address to create your EventSlide account',
    intro: 'Someone asked for an EventSlide account to be created with this address.',
    open: (hours) =>
      `To confirm it was you, open this link within the next ${hours === 1 ? 'hour' : `${hours} hours`}:`,
    ignore: 'You did not ask for this? Ignore this message, nothing will be created.',
  },
  de: {
    subject: 'Bestätigen Sie Ihre Adresse, um Ihr EventSlide-Konto zu erstellen',
    intro: 'Jemand hat die Erstellung eines EventSlide-Kontos mit dieser Adresse beantragt.',
    open: (hours) =>
      `Um zu bestätigen, dass Sie es waren, öffnen Sie diesen Link innerhalb der nächsten ${hours === 1 ? 'Stunde' : `${hours} Stunden`}:`,
    ignore: 'Sie haben nichts beantragt? Ignorieren Sie diese Nachricht, es wird nichts erstellt.',
  },
  es: {
    subject: 'Confirme su dirección para crear su cuenta de EventSlide',
    intro: 'Alguien ha solicitado crear una cuenta de EventSlide con esta dirección.',
    open: (hours) =>
      `Para confirmar que fue usted, abra este enlace ${hours === 1 ? 'en la próxima hora' : `en las próximas ${hours} horas`}:`,
    ignore: '¿No ha pedido nada? Ignore este mensaje, no se creará nada.',
  },
  it: {
    subject: 'Confermi il suo indirizzo per creare il suo account EventSlide',
    intro: 'Qualcuno ha richiesto la creazione di un account EventSlide con questo indirizzo.',
    open: (hours) =>
      `Per confermare che è stato lei, apra questo link ${hours === 1 ? 'entro la prossima ora' : `entro le prossime ${hours} ore`}:`,
    ignore: 'Non ha chiesto nulla? Ignori questo messaggio, non verrà creato nulla.',
  },
}

export const signupConfirmationMail = ({
  to,
  locale,
  link,
  lifetimeHours,
}: SignupConfirmationMailInput): OutgoingMail => {
  const template = CONFIRMATION[locale]
  const before = [HELLO[locale], '', template.intro, '', template.open(lifetimeHours)].join('\n')
  const after = [template.ignore, '', 'EventSlide'].join('\n')
  return { to, subject: template.subject, text: `${before}\n\n${link}\n\n${after}\n` }
}

/** Where a confirmation link points: a path under the public origin, token in the path (see `invitationLink`). */
export const signupConfirmLink = (publicUrl: string, token: string): string =>
  `${publicUrl}/signup/confirm/${encodeURIComponent(token)}`

/* ------------------------------------------------------------------------------------------------ */

export interface SignupRefusedMailInput {
  readonly to: EmailAddress
  readonly locale: ClientLocale
  /** The self-hosting documentation. */
  readonly selfHostLink: string
  /** Answers to this mail go here. */
  readonly replyTo: EmailAddress
}

interface RefusedTemplate {
  readonly subject: string
  readonly body: string
  readonly selfHost: string
}

const REFUSED: Readonly<Record<ClientLocale, RefusedTemplate>> = {
  fr: {
    subject: 'Votre demande de compte EventSlide',
    body: 'Je ne peux pas ouvrir de compte pour le moment.',
    selfHost: `Vous pouvez héberger EventSlide vous-même, le guide est ici${NBSP}:`,
  },
  en: {
    subject: 'Your EventSlide account request',
    body: 'I cannot open an account for the moment.',
    selfHost: 'You can host EventSlide yourself, the guide is here:',
  },
  de: {
    subject: 'Ihre Anfrage für ein EventSlide-Konto',
    body: 'Ich kann im Moment kein Konto eröffnen.',
    selfHost: 'Sie können EventSlide selbst hosten, die Anleitung finden Sie hier:',
  },
  es: {
    subject: 'Su solicitud de cuenta de EventSlide',
    body: 'Por el momento no puedo abrir una cuenta.',
    selfHost: 'Puede alojar EventSlide usted mismo, la guía está aquí:',
  },
  it: {
    subject: 'La sua richiesta di account EventSlide',
    body: 'Al momento non posso aprire un account.',
    selfHost: 'Può ospitare EventSlide da sé, la guida è qui:',
  },
}

export const signupRefusedMail = ({
  to,
  locale,
  selfHostLink,
  replyTo,
}: SignupRefusedMailInput): OutgoingMail => {
  const template = REFUSED[locale]
  const text = [
    HELLO[locale],
    '',
    template.body,
    '',
    template.selfHost,
    '',
    selfHostLink,
    '',
    'EventSlide',
    '',
  ].join('\n')
  return { to, subject: template.subject, text, replyTo }
}

/* ------------------------------------------------------------------------------------------------ */

export type SignupNoticeKind = 'opened' | 'waiting'

export interface SignupOperatorNoticeMailInput {
  readonly to: EmailAddress
  readonly locale: ClientLocale
  /** `opened`: accounts opened by themselves. `waiting`: requests that need a decision. */
  readonly kind: SignupNoticeKind
  /** How many, at least one. */
  readonly count: number
  /** The console page that lists them. */
  readonly link: string
}

interface NoticeTemplate {
  readonly subjects: Readonly<Record<SignupNoticeKind, (count: number) => string>>
  readonly open: string
}

const NOTICE: Readonly<Record<ClientLocale, NoticeTemplate>> = {
  fr: {
    subjects: {
      opened: (n) => (n === 1 ? '1 nouveau compte EventSlide' : `${n} nouveaux comptes EventSlide`),
      waiting: (n) => (n === 1 ? '1 inscription à valider' : `${n} inscriptions à valider`),
    },
    open: `Le détail est dans la console${NBSP}:`,
  },
  en: {
    subjects: {
      opened: (n) => (n === 1 ? '1 new EventSlide account' : `${n} new EventSlide accounts`),
      waiting: (n) => (n === 1 ? '1 signup to review' : `${n} signups to review`),
    },
    open: 'The details are in the console:',
  },
  de: {
    subjects: {
      opened: (n) => (n === 1 ? '1 neues EventSlide-Konto' : `${n} neue EventSlide-Konten`),
      waiting: (n) => (n === 1 ? '1 Anmeldung zu prüfen' : `${n} Anmeldungen zu prüfen`),
    },
    open: 'Die Einzelheiten stehen in der Konsole:',
  },
  es: {
    subjects: {
      opened: (n) =>
        n === 1 ? '1 cuenta nueva de EventSlide' : `${n} cuentas nuevas de EventSlide`,
      waiting: (n) => (n === 1 ? '1 registro por revisar' : `${n} registros por revisar`),
    },
    open: 'Los detalles están en la consola:',
  },
  it: {
    subjects: {
      opened: (n) => (n === 1 ? '1 nuovo account EventSlide' : `${n} nuovi account EventSlide`),
      waiting: (n) => (n === 1 ? '1 iscrizione da verificare' : `${n} iscrizioni da verificare`),
    },
    open: 'I dettagli sono nella console:',
  },
}

export const signupOperatorNoticeMail = ({
  to,
  locale,
  kind,
  count,
  link,
}: SignupOperatorNoticeMailInput): Result<OutgoingMail, DomainError> => {
  // A notice about nothing is a bug in the caller, not a mail to send.
  if (!Number.isInteger(count) || count < 1) {
    return err(DomainError.invalid('signup.notice.countInvalid'))
  }
  const template = NOTICE[locale]
  const subject = template.subjects[kind](count)
  return ok({ to, subject, text: `${subject}\n\n${template.open}\n\n${link}\n` })
}

/** The operator's page of signups. */
export const signupConsoleLink = (publicUrl: string): string => `${publicUrl}/admin/site/signups`

/* ------------------------------------------------------------------------------------------------ */

export interface WelcomeMailInput {
  readonly to: EmailAddress
  readonly locale: ClientLocale
  /** The site's guides, the one link. */
  readonly guidesLink: string
  /** The contact address: named in the text, and where a reply goes. */
  readonly contact: EmailAddress
}

interface WelcomeTemplate {
  readonly subject: string
  readonly intro: string
  readonly steps: readonly [string, string, string]
  readonly guides: string
  readonly question: (contact: string) => string
}

const WELCOME: Readonly<Record<ClientLocale, WelcomeTemplate>> = {
  fr: {
    subject: 'Bienvenue sur EventSlide',
    intro: `Votre compte est prêt. Pour commencer${NBSP}:`,
    steps: [
      '1. Créez votre événement.',
      '2. Imprimez le QR code pour vos invités.',
      '3. Testez le mur avec quelques photos.',
    ],
    guides: `Les guides pas à pas sont ici${NBSP}:`,
    question: (contact) => `Une question${NBSP}? Écrivez à ${contact}.`,
  },
  en: {
    subject: 'Welcome to EventSlide',
    intro: 'Your account is ready. To get started:',
    steps: [
      '1. Create your event.',
      '2. Print the QR code for your guests.',
      '3. Try the wall with a few photos.',
    ],
    guides: 'The step-by-step guides are here:',
    question: (contact) => `A question? Write to ${contact}.`,
  },
  de: {
    subject: 'Willkommen bei EventSlide',
    intro: 'Ihr Konto ist bereit. So fangen Sie an:',
    steps: [
      '1. Erstellen Sie Ihre Veranstaltung.',
      '2. Drucken Sie den QR-Code für Ihre Gäste.',
      '3. Testen Sie die Wand mit ein paar Fotos.',
    ],
    guides: 'Die Schritt-für-Schritt-Anleitungen finden Sie hier:',
    question: (contact) => `Eine Frage? Schreiben Sie an ${contact}.`,
  },
  es: {
    subject: 'Bienvenido a EventSlide',
    intro: 'Su cuenta está lista. Para empezar:',
    steps: [
      '1. Cree su evento.',
      '2. Imprima el código QR para sus invitados.',
      '3. Pruebe el muro con unas fotos.',
    ],
    guides: 'Las guías paso a paso están aquí:',
    question: (contact) => `¿Una pregunta? Escriba a ${contact}.`,
  },
  it: {
    subject: 'Benvenuto su EventSlide',
    intro: 'Il suo account è pronto. Per iniziare:',
    steps: [
      '1. Crei il suo evento.',
      '2. Stampi il QR code per i suoi ospiti.',
      '3. Provi il muro con qualche foto.',
    ],
    guides: 'Le guide passo passo sono qui:',
    question: (contact) => `Una domanda? Scriva a ${contact}.`,
  },
}

export const welcomeMail = ({
  to,
  locale,
  guidesLink,
  contact,
}: WelcomeMailInput): OutgoingMail => {
  const template = WELCOME[locale]
  const text = [
    HELLO[locale],
    '',
    template.intro,
    '',
    ...template.steps,
    '',
    template.guides,
    '',
    guidesLink,
    '',
    template.question(contact.value),
    '',
    'EventSlide',
    '',
  ].join('\n')
  return { to, subject: template.subject, text, replyTo: contact }
}
