import type { ClientLocale } from '../clients/clientLocale'
import type { EmailAddress } from '../users/emailAddress'
import type { OutgoingMail } from './outgoingMail'

/**
 * The message that carries a password-reset link (docs/ROADMAP.md §10.3; free plan G2-08,
 * paid plan P3-09), in the five languages the product speaks.
 *
 * **Plain text only.** A reset mail is a credential in transit, and an HTML part is a
 * surface: a remote image is a request that tells a stranger when the mail was opened, a
 * link whose text differs from its target is the shape of phishing. The plain-text part is
 * the one every mail client, screen reader and lock-screen preview can read
 * (`OutgoingMail`'s own note says so), and a message that is *only* that has nothing else to
 * go wrong. No image, no tracking pixel, no second link.
 *
 * **The link is the only thing in it that matters, and it appears once, on a line of its
 * own** — so a mail client that wraps a long line cannot cut the token in two, and a person
 * copying it from a plain-text view selects exactly that line.
 *
 * Written in the language of the person it is for: the one the page they asked from was in
 * (`locale`), defaulting to French, the product's source language. French is written by
 * hand with its accents and a deliberate register; the others follow it.
 *
 * Pure: a function of its arguments, no clock and no configuration. The lifetime it quotes
 * is passed in, so the message can never promise longer than the token lives.
 */

export interface PasswordResetMailInput {
  readonly to: EmailAddress
  readonly locale: ClientLocale
  /** The absolute URL carrying the token. */
  readonly link: string
  /** How long the link works, in whole minutes. */
  readonly lifetimeMinutes: number
}

interface Template {
  readonly subject: string
  /** Everything before the link, then everything after it. */
  readonly body: (lifetimeMinutes: number) => { readonly before: string; readonly after: string }
}

const TEMPLATES: Readonly<Record<ClientLocale, Template>> = {
  fr: {
    subject: 'Réinitialisation de votre mot de passe EventSlide',
    body: (minutes) => ({
      before: [
        'Bonjour,',
        '',
        'La réinitialisation du mot de passe du compte EventSlide associé à cette adresse a été demandée.',
        '',
        `Pour choisir un nouveau mot de passe, ouvrez ce lien dans les ${minutes} minutes qui viennent. Il ne peut servir qu'une seule fois :`,
      ].join('\n'),
      after: [
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable, et personne ne peut le changer sans ce lien.",
        '',
        'EventSlide',
      ].join('\n'),
    }),
  },
  en: {
    subject: 'Reset your EventSlide password',
    body: (minutes) => ({
      before: [
        'Hello,',
        '',
        'A password reset was requested for the EventSlide account that uses this address.',
        '',
        `To choose a new password, open this link within the next ${minutes} minutes. It can only be used once:`,
      ].join('\n'),
      after: [
        'If you did not ask for this, ignore this message: your current password still works, and nobody can change it without this link.',
        '',
        'EventSlide',
      ].join('\n'),
    }),
  },
  de: {
    subject: 'Passwort für EventSlide zurücksetzen',
    body: (minutes) => ({
      before: [
        'Guten Tag,',
        '',
        'für das EventSlide-Konto mit dieser Adresse wurde das Zurücksetzen des Passworts angefordert.',
        '',
        `Um ein neues Passwort zu wählen, öffnen Sie diesen Link innerhalb der nächsten ${minutes} Minuten. Er kann nur einmal verwendet werden:`,
      ].join('\n'),
      after: [
        'Wenn Sie das nicht angefordert haben, ignorieren Sie diese Nachricht: Ihr bisheriges Passwort bleibt gültig, und ohne diesen Link kann es niemand ändern.',
        '',
        'EventSlide',
      ].join('\n'),
    }),
  },
  es: {
    subject: 'Restablecer su contraseña de EventSlide',
    body: (minutes) => ({
      before: [
        'Hola,',
        '',
        'Se ha solicitado restablecer la contraseña de la cuenta de EventSlide asociada a esta dirección.',
        '',
        `Para elegir una contraseña nueva, abra este enlace en los próximos ${minutes} minutos. Solo puede usarse una vez:`,
      ].join('\n'),
      after: [
        'Si usted no lo ha solicitado, ignore este mensaje: su contraseña actual sigue siendo válida y nadie puede cambiarla sin este enlace.',
        '',
        'EventSlide',
      ].join('\n'),
    }),
  },
  it: {
    subject: 'Reimpostazione della password di EventSlide',
    body: (minutes) => ({
      before: [
        'Buongiorno,',
        '',
        "è stata richiesta la reimpostazione della password dell'account EventSlide associato a questo indirizzo.",
        '',
        `Per scegliere una nuova password, apra questo link entro i prossimi ${minutes} minuti. Può essere usato una sola volta:`,
      ].join('\n'),
      after: [
        'Se non è stato lei a chiederlo, ignori questo messaggio: la password attuale resta valida e nessuno può cambiarla senza questo link.',
        '',
        'EventSlide',
      ].join('\n'),
    }),
  },
}

export const passwordResetMail = ({
  to,
  locale,
  link,
  lifetimeMinutes,
}: PasswordResetMailInput): OutgoingMail => {
  const template = TEMPLATES[locale]
  const { before, after } = template.body(lifetimeMinutes)

  return { to, subject: template.subject, text: `${before}\n\n${link}\n\n${after}\n` }
}

/**
 * Where a reset link points: a **path** under the instance's public origin, with the token
 * in it rather than in a query string.
 *
 * A path because the places a URL ends up — an access log, a proxy's log, a browser's
 * history, a `Referer` — treat a query string as data to keep and a path as a route to
 * summarise: the access log writes the route *pattern* (`/password/reset/:token`), never the
 * path, and the edge's log filter rewrites `/password/*` the same way (docs/SECURITY.md §9).
 * It is the same decision the shared gallery's `/g/:token` made.
 *
 * `publicUrl` is the configured origin without a trailing slash (`env.ts` strips it), so
 * this only joins.
 */
export const passwordResetLink = (publicUrl: string, token: string): string =>
  `${publicUrl}/password/reset/${encodeURIComponent(token)}`
