import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, type Locale } from './locale'
import { TRANSLATIONS } from './translations'
import { walkTable, type Rendered } from './testing/walkTable'

/**
 * The lexicon: which word names which thing, held by machine in every language.
 *
 * `orthography.test.ts` asks whether a word is spelled correctly. This file asks whether
 * the right word is used for the thing, which a reviewer reading a copy diff cannot see
 * either: "galerie" looks fine in a sentence, and the sentence next to it says "album"
 * for the same thing. The decisions, from the UX review of 2026-10-30 (NAV-5, NAV-10,
 * NAV-12, NAV-15, APR-12, HOT-15):
 *
 * - The live event is *la soirée* for a guest and on the wall, and never *la galerie*.
 *   *Album* is what is left after the evening, and nothing else.
 * - The code a host says aloud is the code a guest reads: one label on both sides.
 * - The link for the guests is not an "invitation": an invitation opens an account.
 * - A status badge and the button that causes it use the same verb, and the operator's
 *   console says the same status words as the host's.
 * - "Console" is the operator's console, and nothing else.
 *
 * It reads wording on purpose, like `fr.test.ts`, because wording is the subject.
 */

const written = (locale: Locale): readonly Rendered[] => walkTable(TRANSLATIONS[locale])

/**
 * The retired names of the live event, per language. A word that is still right in the
 * language for the thing it names after the evening (`album`) is deliberately absent.
 */
const RETIRED: Readonly<Record<Locale, readonly [RegExp, string][]>> = {
  fr: [
    [/galerie/iu, 'galerie: the live event is "la soirée", and what is left after it is "l’album"'],
    [/événement/iu, 'événement: this product writes évènement'],
    [/code d’accès/iu, 'Code d’accès: the code is "Code de la soirée" on both sides'],
    [/réouvr/iu, 'Réouvrir: the verb is rouvrir'],
    [/kraft/iu, 'Kraft: the default colour is the ambiance’s own, not a paper'],
    [/\bclore\b|clôtur/iu, 'clore / clôturer: the lifecycle says terminer'],
  ],
  en: [
    [/galler/iu, 'gallery: the live event is "the event", and after it comes "the album"'],
    [/access code/iu, 'Access code: the code is "Event code" on both sides'],
    [/kraft/iu, 'Kraft: the default colour is the ambiance’s own, not a paper'],
  ],
  de: [
    [/galerie/iu, 'Galerie: the live event is "die Feier", and after it comes "das Album"'],
    [/zugangscode/iu, 'Zugangscode: the code is "Code der Feier" on both sides'],
    [/kraft/iu, 'Kraftpapier: the default colour is the ambiance’s own, not a paper'],
  ],
  es: [
    [/galer[ií]a/iu, 'galería: the live event is "la fiesta", and after it comes "el álbum"'],
    [/c[oó]digo de acceso/iu, 'Código de acceso: the code is "Código de la fiesta" on both sides'],
    [/kraft/iu, 'Kraft: the default colour is the ambiance’s own, not a paper'],
  ],
  it: [
    [/galleri/iu, 'galleria: the live event is "la serata", and after it comes "l’album"'],
    [/codice di accesso/iu, 'Codice di accesso: the code is "Codice della serata" on both sides'],
    [/kraft/iu, 'Kraft: the default colour is the ambiance’s own, not a paper'],
  ],
}

describe.each(SUPPORTED_LOCALES)('%s', (locale) => {
  it.each(RETIRED[locale])('says %s nowhere', (pattern, reason) => {
    for (const { path, text } of written(locale)) {
      expect(pattern.test(text), `${locale}.${path} still says ${reason}`).toBe(false)
    }
  })

  it('gives the host and the guest the same label for the code said aloud', () => {
    const table = TRANSLATIONS[locale]

    expect(table.admin.joinCode).toBe(table.join.codeLabel)
    expect(table.wall.codeLabel).toBe(table.join.codeLabel)
  })

  it('keeps "invitation" for opening an account, not for the guests’ link', () => {
    const table = TRANSLATIONS[locale]

    expect(table.admin.joinLink).not.toBe(table.site.invitationLinkLabel)
    expect(table.admin.joinLink.toLowerCase()).not.toMatch(
      /invitation|einladung|invito|invitación/u,
    )
  })

  it('says the same status words in the operator’s console as on the host’s page', () => {
    const { admin, site } = TRANSLATIONS[locale]

    expect(site.eventStatuses.draft).toBe(admin.statusDraft)
    expect(site.eventStatuses.live).toBe(admin.statusLive)
    expect(site.eventStatuses.closed).toBe(admin.statusClosed)
    expect(site.eventStatuses.archived).toBe(admin.statusArchived)
  })

  it('uses the word "console" only for the operator’s console', () => {
    for (const { path, text } of written(locale)) {
      if (!/consol|konsole/iu.test(text)) continue
      expect(path.startsWith('site.') || path.startsWith('titles.site'), `${locale}.${path}`).toBe(
        true,
      )
    }
  })
})

describe('fr, where the button and the badge are one word', () => {
  const { admin } = TRANSLATIONS.fr

  it('ends an event with the verb its badge is the participle of', () => {
    expect(admin.closeEvent).toMatch(/^Terminer /u)
    expect(admin.statusClosed).toBe('Terminé')
    expect(admin.scheduleCloseAt).toMatch(/^Terminer /u)
  })

  it('writes the verb for undoing it correctly', () => {
    expect(admin.reopenEvent).toBe('Rouvrir')
  })

  it('counts the retention from the end of the event, and says that nothing goes before it', () => {
    expect(admin.retentionDays(30)).toContain('fin de l’évènement')
    expect(admin.retentionHint).toContain('pas terminé')
  })
})
