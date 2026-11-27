import type { ClientLocale } from '../clients/clientLocale'
import type { EmailAddress } from '../users/emailAddress'
import type { OutgoingMail } from './outgoingMail'

/**
 * The mails that tell an account holder what was done to the account (spec 32, A1, A1b and A1c): a password changed
 * or reset, the second factor turned on or off, the recovery codes renewed, the account disabled or enabled by the
 * operator, the account deleted. **They are sent whatever the host's e-mail switches say** (`HOST_MAIL_NOTICES=off`
 * does not stop them): an act the holder did not do is the one the box must say.
 *
 * - **Short, no token, no IP, no device, no place** (none of it is kept). The instant is spelt in UTC, with `(UTC)`.
 * - **One link at most**, and only for the five security acts: `/password/forgot`, where the holder resets the password
 *   at once if it was not them. The operator's acts (disabled, enabled) and the deletion carry no link.
 * - When the operator's contact address is configured, the mail of a disabling **or an enabling** carries it as `replyTo` and says to answer
 *   it; without one that sentence is not written.
 *
 * Pure: a function of its arguments.
 */

export const ACCOUNT_CHANGE_KINDS = [
  'passwordChanged',
  'passwordReset',
  'totpEnabled',
  'totpDisabled',
  'recoveryCodesRegenerated',
  'accountDisabled',
  'accountEnabled',
  'accountDeleted',
] as const

export type AccountChangeKind = (typeof ACCOUNT_CHANGE_KINDS)[number]

/** The five acts the holder may not have done themselves, which carry the "reset it now" link. */
const SECURITY_KINDS: readonly AccountChangeKind[] = [
  'passwordChanged',
  'passwordReset',
  'totpEnabled',
  'totpDisabled',
  'recoveryCodesRegenerated',
]

export const carriesResetLink = (kind: AccountChangeKind): boolean => SECURITY_KINDS.includes(kind)

export interface AccountChangeMailInput {
  readonly to: EmailAddress
  readonly locale: ClientLocale
  readonly kind: AccountChangeKind
  /** When it happened. */
  readonly at: Date
  /** `/password/forgot` under the public origin; only used by the five security acts. */
  readonly forgotUrl: string
  /** The operator's contact address, for the mail of a disabling: `replyTo` and a sentence. `null` for none. */
  readonly replyTo: EmailAddress | null
}

interface Template {
  readonly greeting: string
  /** `{when}` is replaced by the instant. */
  readonly lines: Readonly<Record<AccountChangeKind, string>>
  readonly subjects: Readonly<Record<AccountChangeKind, string>>
  readonly notYou: string
  readonly question: string
  /** What stands between the day and the hour, spaces included: « à », "at", or a comma where the article would not read right at every hour. */
  readonly at: string
}

/** A real no-break space, for the French spacing before `:` and inside « ». */
const NBSP = String.fromCharCode(160)

const TEMPLATES: Readonly<Record<ClientLocale, Template>> = {
  fr: {
    greeting: 'Bonjour,',
    lines: {
      passwordChanged: 'Le mot de passe de votre compte EventSlide a été changé le {when}.',
      passwordReset: 'Le mot de passe de votre compte EventSlide a été réinitialisé le {when}.',
      totpEnabled:
        'La vérification en deux étapes a été activée sur votre compte EventSlide le {when}.',
      totpDisabled:
        'La vérification en deux étapes a été désactivée sur votre compte EventSlide le {when}.',
      recoveryCodesRegenerated:
        'Les codes de secours de votre compte EventSlide ont été renouvelés le {when}.',
      accountDisabled: 'Votre compte EventSlide a été désactivé par l’opérateur le {when}.',
      accountEnabled: 'Votre compte EventSlide a été réactivé par l’opérateur le {when}.',
      accountDeleted: 'Votre compte EventSlide et ses données ont été supprimés le {when}.',
    },
    subjects: {
      passwordChanged: 'Votre mot de passe EventSlide a été changé',
      passwordReset: 'Votre mot de passe EventSlide a été réinitialisé',
      totpEnabled: 'La vérification en deux étapes est activée',
      totpDisabled: 'La vérification en deux étapes est désactivée',
      recoveryCodesRegenerated: 'Vos codes de secours ont été renouvelés',
      accountDisabled: 'Votre compte EventSlide a été désactivé',
      accountEnabled: 'Votre compte EventSlide a été réactivé',
      accountDeleted: 'Votre compte EventSlide a été supprimé',
    },
    notYou: `Si ce n’est pas vous, réinitialisez votre mot de passe tout de suite${NBSP}:`,
    question: `Une question${NBSP}: répondez à ce message.`,
    at: ' à ',
  },
  en: {
    greeting: 'Hello,',
    lines: {
      passwordChanged: 'The password of your EventSlide account was changed on {when}.',
      passwordReset: 'The password of your EventSlide account was reset on {when}.',
      totpEnabled: 'Two-step verification was turned on for your EventSlide account on {when}.',
      totpDisabled: 'Two-step verification was turned off for your EventSlide account on {when}.',
      recoveryCodesRegenerated:
        'The recovery codes of your EventSlide account were renewed on {when}.',
      accountDisabled: 'Your EventSlide account was disabled by the operator on {when}.',
      accountEnabled: 'Your EventSlide account was enabled again by the operator on {when}.',
      accountDeleted: 'Your EventSlide account and its data were deleted on {when}.',
    },
    subjects: {
      passwordChanged: 'Your EventSlide password was changed',
      passwordReset: 'Your EventSlide password was reset',
      totpEnabled: 'Two-step verification is on',
      totpDisabled: 'Two-step verification is off',
      recoveryCodesRegenerated: 'Your recovery codes were renewed',
      accountDisabled: 'Your EventSlide account was disabled',
      accountEnabled: 'Your EventSlide account was enabled again',
      accountDeleted: 'Your EventSlide account was deleted',
    },
    notYou: 'If this was not you, reset your password right away:',
    question: 'A question? Reply to this message.',
    at: ' at ',
  },
  de: {
    greeting: 'Guten Tag,',
    lines: {
      passwordChanged: 'Das Passwort Ihres EventSlide-Kontos wurde am {when} geändert.',
      passwordReset: 'Das Passwort Ihres EventSlide-Kontos wurde am {when} zurückgesetzt.',
      totpEnabled:
        'Die Bestätigung in zwei Schritten wurde am {when} für Ihr EventSlide-Konto eingeschaltet.',
      totpDisabled:
        'Die Bestätigung in zwei Schritten wurde am {when} für Ihr EventSlide-Konto ausgeschaltet.',
      recoveryCodesRegenerated:
        'Die Wiederherstellungscodes Ihres EventSlide-Kontos wurden am {when} erneuert.',
      accountDisabled: 'Ihr EventSlide-Konto wurde am {when} vom Betreiber deaktiviert.',
      accountEnabled: 'Ihr EventSlide-Konto wurde am {when} vom Betreiber wieder aktiviert.',
      accountDeleted: 'Ihr EventSlide-Konto und seine Daten wurden am {when} gelöscht.',
    },
    subjects: {
      passwordChanged: 'Ihr EventSlide-Passwort wurde geändert',
      passwordReset: 'Ihr EventSlide-Passwort wurde zurückgesetzt',
      totpEnabled: 'Bestätigung in zwei Schritten eingeschaltet',
      totpDisabled: 'Bestätigung in zwei Schritten ausgeschaltet',
      recoveryCodesRegenerated: 'Ihre Wiederherstellungscodes wurden erneuert',
      accountDisabled: 'Ihr EventSlide-Konto wurde deaktiviert',
      accountEnabled: 'Ihr EventSlide-Konto wurde wieder aktiviert',
      accountDeleted: 'Ihr EventSlide-Konto wurde gelöscht',
    },
    notYou: 'Wenn Sie das nicht waren, setzen Sie Ihr Passwort sofort zurück:',
    question: 'Eine Frage? Antworten Sie auf diese Nachricht.',
    at: ' um ',
  },
  es: {
    greeting: 'Hola,',
    lines: {
      passwordChanged: 'La contraseña de su cuenta de EventSlide se cambió el {when}.',
      passwordReset: 'La contraseña de su cuenta de EventSlide se restableció el {when}.',
      totpEnabled: 'La verificación en dos pasos se activó en su cuenta de EventSlide el {when}.',
      totpDisabled:
        'La verificación en dos pasos se desactivó en su cuenta de EventSlide el {when}.',
      recoveryCodesRegenerated:
        'Los códigos de recuperación de su cuenta de EventSlide se renovaron el {when}.',
      accountDisabled: 'El operador desactivó su cuenta de EventSlide el {when}.',
      accountEnabled: 'El operador volvió a activar su cuenta de EventSlide el {when}.',
      accountDeleted: 'Su cuenta de EventSlide y sus datos se eliminaron el {when}.',
    },
    subjects: {
      passwordChanged: 'Su contraseña de EventSlide se cambió',
      passwordReset: 'Su contraseña de EventSlide se restableció',
      totpEnabled: 'Verificación en dos pasos activada',
      totpDisabled: 'Verificación en dos pasos desactivada',
      recoveryCodesRegenerated: 'Sus códigos de recuperación se renovaron',
      accountDisabled: 'Su cuenta de EventSlide se desactivó',
      accountEnabled: 'Su cuenta de EventSlide se volvió a activar',
      accountDeleted: 'Su cuenta de EventSlide se eliminó',
    },
    notYou: 'Si no fue usted, restablezca su contraseña de inmediato:',
    question: '¿Una pregunta? Responda a este mensaje.',
    at: ', ',
  },
  it: {
    greeting: 'Buongiorno,',
    lines: {
      passwordChanged: 'La password del suo account EventSlide è stata cambiata il {when}.',
      passwordReset: 'La password del suo account EventSlide è stata reimpostata il {when}.',
      totpEnabled:
        'La verifica in due passaggi è stata attivata sul suo account EventSlide il {when}.',
      totpDisabled:
        'La verifica in due passaggi è stata disattivata sul suo account EventSlide il {when}.',
      recoveryCodesRegenerated:
        'I codici di recupero del suo account EventSlide sono stati rinnovati il {when}.',
      accountDisabled: 'Il suo account EventSlide è stato disattivato dall’operatore il {when}.',
      accountEnabled: 'Il suo account EventSlide è stato riattivato dall’operatore il {when}.',
      accountDeleted: 'Il suo account EventSlide e i suoi dati sono stati eliminati il {when}.',
    },
    subjects: {
      passwordChanged: 'La sua password EventSlide è stata cambiata',
      passwordReset: 'La sua password EventSlide è stata reimpostata',
      totpEnabled: 'Verifica in due passaggi attivata',
      totpDisabled: 'Verifica in due passaggi disattivata',
      recoveryCodesRegenerated: 'I suoi codici di recupero sono stati rinnovati',
      accountDisabled: 'Il suo account EventSlide è stato disattivato',
      accountEnabled: 'Il suo account EventSlide è stato riattivato',
      accountDeleted: 'Il suo account EventSlide è stato eliminato',
    },
    notYou: 'Se non è stato lei, reimposti subito la password:',
    question: 'Una domanda? Risponda a questo messaggio.',
    at: ', ',
  },
}

/** The instant in UTC, spelt by the language: « 27 novembre 2026 à 14:32 (UTC) ». */
const whenIn = (locale: ClientLocale, at: Date, joiner: string): string => {
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(at)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at)
  return `${day}${joiner}${time} (UTC)`
}

export const accountChangeMail = ({
  to,
  locale,
  kind,
  at,
  forgotUrl,
  replyTo,
}: AccountChangeMailInput): OutgoingMail => {
  const template = TEMPLATES[locale]
  const body: string[] = [
    template.greeting,
    '',
    template.lines[kind].replace('{when}', whenIn(locale, at, template.at)),
  ]
  if (carriesResetLink(kind)) {
    body.push('', template.notYou, forgotUrl)
  }
  const reply = kind === 'accountDisabled' || kind === 'accountEnabled' ? replyTo : null
  if (reply !== null) body.push('', template.question)
  body.push('', 'EventSlide', '')

  return {
    to,
    subject: template.subjects[kind],
    text: body.join('\n'),
    ...(reply === null ? {} : { replyTo: reply }),
  }
}

/** `/password/forgot` under the configured public origin. */
export const accountForgotUrl = (publicUrl: string): string => `${publicUrl}/password/forgot`
