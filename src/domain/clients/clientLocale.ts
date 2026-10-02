/**
 * The language a client's system mail is written in (paid plan §"Schéma des clients",
 * P3-04): invitations, password resets, account notices — `Mailer` (P3-08) reads this to
 * pick a template.
 *
 * Deliberately not {@link EventLanguage}. That type is the projected wall's own policy,
 * set once and read by nobody but the room; this is addressed to a *person* — the client
 * owner — the same way a guest's or a host's own locale is in CLAUDE.md §6's "three
 * surfaces, two answers about language". Folding the two into one type would make a
 * client's mail follow their wall's language, which is a venue's screen and not their inbox.
 */

export const CLIENT_LOCALES = ['fr', 'en', 'de', 'es', 'it'] as const

export type ClientLocale = (typeof CLIENT_LOCALES)[number]

/** What a client gets when nobody said: every client created before P3-08 mails in it. */
export const DEFAULT_CLIENT_LOCALE: ClientLocale = 'fr'

export const isClientLocale = (value: unknown): value is ClientLocale =>
  typeof value === 'string' && (CLIENT_LOCALES as readonly string[]).includes(value)
