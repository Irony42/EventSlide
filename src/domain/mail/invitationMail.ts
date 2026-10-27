import type { ClientLocale } from '../clients/clientLocale'
import type { ClientRole } from '../clients/clientRole'
import type { EmailAddress } from '../users/emailAddress'
import type { OutgoingMail } from './outgoingMail'
import { toSingleLine } from '../shared/plainText'

/**
 * The message that carries an invitation link (docs/ROADMAP.md §10.3; free plan G2-09, paid
 * plan P3-10), in the five languages the product speaks.
 *
 * **Everything `passwordResetMail` argues applies, and one more thing does.** Plain text only,
 * one link, on a line of its own, no image and no second URL: an invitation link is a password
 * reset for an account that does not exist yet, and a message that is only text has nothing
 * else to go wrong.
 *
 * **It is neutral about who is writing.** The recipient may never have heard of the host, the
 * operator or the person who typed their address; an invitation mail is also the one message
 * this product sends to a stranger on someone else's say-so. So it says what it offers and
 * what it costs to ignore it: nothing happens until the link is opened. It does not name the
 * inviter, which is a person's name the recipient did not choose to receive, and it never says
 * whether the address already has an account — the mail is the same for an address that does
 * and one that does not, which is what keeps the invitation form from being an oracle for who
 * uses the box.
 *
 * What it does name is the **target**: the event, or the client's space. That is content a
 * person typed (CLAUDE.md §6) and is printed as written, in whatever language it was written
 * in, only with its whitespace flattened so a name cannot lay out the message.
 *
 * Pure: a function of its arguments. The lifetime it quotes is passed in, so the message can
 * never promise longer than the token lives.
 */

/** What the link opens, as the mail needs to say it: a client's space carries the role. */
export type InvitationMailTarget =
  | { readonly kind: 'event'; readonly name: string }
  | { readonly kind: 'client'; readonly name: string; readonly role: ClientRole }

export interface InvitationMailInput {
  readonly to: EmailAddress
  readonly locale: ClientLocale
  /** The absolute URL carrying the token. */
  readonly link: string
  readonly target: InvitationMailTarget
  /** How long the link works, in whole days. */
  readonly lifetimeDays: number
}

type Offer = 'moderateEvent' | 'manageClient' | 'joinClient'

interface Template {
  readonly subjects: { readonly event: string; readonly client: string }
  readonly greeting: string
  /** What is offered; `name` is already flattened. */
  readonly offer: Readonly<Record<Offer, (name: string) => string>>
  readonly open: (days: number) => string
  readonly ignore: string
}

const TEMPLATES: Readonly<Record<ClientLocale, Template>> = {
  fr: {
    subjects: {
      event: 'Invitation à modérer un événement sur EventSlide',
      client: 'Invitation à rejoindre EventSlide',
    },
    greeting: 'Bonjour,',
    offer: {
      moderateEvent: (name) =>
        `Vous êtes invité(e) à modérer l'événement « ${name} » sur EventSlide.`,
      manageClient: (name) => `Vous êtes invité(e) à gérer l'espace EventSlide « ${name} ».`,
      joinClient: (name) => `Vous êtes invité(e) à rejoindre l'espace EventSlide « ${name} ».`,
    },
    open: (days) =>
      `Pour accepter, ouvrez ce lien dans les ${days} jours qui viennent. Il ne peut servir qu'une seule fois :`,
    ignore:
      "Si vous n'attendiez pas cette invitation, ignorez ce message : rien ne se passe tant que ce lien n'est pas ouvert.",
  },
  en: {
    subjects: {
      event: 'You are invited to moderate an event on EventSlide',
      client: 'You are invited to EventSlide',
    },
    greeting: 'Hello,',
    offer: {
      moderateEvent: (name) =>
        `You have been invited to moderate the event "${name}" on EventSlide.`,
      manageClient: (name) => `You have been invited to manage the EventSlide space "${name}".`,
      joinClient: (name) => `You have been invited to join the EventSlide space "${name}".`,
    },
    open: (days) =>
      `To accept, open this link within the next ${days} days. It can only be used once:`,
    ignore:
      'If you were not expecting this invitation, ignore this message: nothing happens until this link is opened.',
  },
  de: {
    subjects: {
      event: 'Einladung zur Moderation einer Veranstaltung auf EventSlide',
      client: 'Einladung zu EventSlide',
    },
    greeting: 'Guten Tag,',
    offer: {
      moderateEvent: (name) =>
        `Sie wurden eingeladen, die Veranstaltung „${name}“ auf EventSlide zu moderieren.`,
      manageClient: (name) =>
        `Sie wurden eingeladen, den EventSlide-Bereich „${name}“ zu verwalten.`,
      joinClient: (name) => `Sie wurden eingeladen, dem EventSlide-Bereich „${name}“ beizutreten.`,
    },
    open: (days) =>
      `Zum Annehmen öffnen Sie diesen Link innerhalb der nächsten ${days} Tage. Er kann nur einmal verwendet werden:`,
    ignore:
      'Wenn Sie diese Einladung nicht erwartet haben, ignorieren Sie diese Nachricht: Es passiert nichts, solange dieser Link nicht geöffnet wird.',
  },
  es: {
    subjects: {
      event: 'Invitación para moderar un evento en EventSlide',
      client: 'Invitación a EventSlide',
    },
    greeting: 'Hola,',
    offer: {
      moderateEvent: (name) => `Le han invitado a moderar el evento «${name}» en EventSlide.`,
      manageClient: (name) => `Le han invitado a gestionar el espacio de EventSlide «${name}».`,
      joinClient: (name) => `Le han invitado a unirse al espacio de EventSlide «${name}».`,
    },
    open: (days) =>
      `Para aceptar, abra este enlace en los próximos ${days} días. Solo puede usarse una vez:`,
    ignore:
      'Si no esperaba esta invitación, ignore este mensaje: no ocurre nada mientras no se abra este enlace.',
  },
  it: {
    subjects: {
      event: 'Invito a moderare un evento su EventSlide',
      client: 'Invito a EventSlide',
    },
    greeting: 'Buongiorno,',
    offer: {
      moderateEvent: (name) => `È stato invitato a moderare l'evento «${name}» su EventSlide.`,
      manageClient: (name) => `È stato invitato a gestire lo spazio EventSlide «${name}».`,
      joinClient: (name) => `È stato invitato a unirsi allo spazio EventSlide «${name}».`,
    },
    open: (days) =>
      `Per accettare, apra questo link entro i prossimi ${days} giorni. Può essere usato una sola volta:`,
    ignore:
      'Se non si aspettava questo invito, ignori questo messaggio: non succede nulla finché questo link non viene aperto.',
  },
}

const offerFor = (target: InvitationMailTarget): Offer => {
  if (target.kind === 'event') return 'moderateEvent'
  return target.role === 'owner' ? 'manageClient' : 'joinClient'
}

export const invitationMail = ({
  to,
  locale,
  link,
  target,
  lifetimeDays,
}: InvitationMailInput): OutgoingMail => {
  const template = TEMPLATES[locale]
  const offer = template.offer[offerFor(target)](toSingleLine(target.name))

  const before = [template.greeting, '', offer, '', template.open(lifetimeDays)].join('\n')
  const after = [template.ignore, '', 'EventSlide'].join('\n')

  return {
    to,
    subject: template.subjects[target.kind],
    text: `${before}\n\n${link}\n\n${after}\n`,
  }
}

/**
 * Where an invitation link points: a **path** under the instance's public origin, with the
 * token in it rather than in a query string — for the reason `passwordResetLink` gives. This
 * box's own request log writes it as `/invite/:token` (`loggablePath`), and a reverse proxy in
 * front of it is the operator's own: its access log must be told not to record `/invite/*`, as
 * the hosted instance's is (free plan F-13 and G5-02).
 *
 * `publicUrl` is the configured origin without a trailing slash (the config loader strips it), so this
 * only joins.
 */
export const invitationLink = (publicUrl: string, token: string): string =>
  `${publicUrl}/invite/${encodeURIComponent(token)}`
