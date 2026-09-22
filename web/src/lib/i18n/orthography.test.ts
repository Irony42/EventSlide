import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, type Locale } from './locale'
import { TRANSLATIONS } from './translations'
import { FORBIDDEN, ORTHOGRAPHY, repertoireFor } from './testing/orthography'
import { walkTable, type Rendered } from './testing/walkTable'

/**
 * The accent rule, for five languages instead of one.
 *
 * French copy in this repository has always carried correct accents because whoever
 * wrote it cared, and that is exactly the guarantee that does not survive being
 * multiplied by five. Nobody reviewing a diff is going to notice `fuer` where `für`
 * belongs, or a Spanish question that opens with nothing, or an `é` that is really `e`
 * followed by a combining acute — which renders identically, matches no search, and is
 * how an accent disappears without anybody touching it.
 *
 * Every rule below runs over **every** language, French included. The French table is
 * now held by machine where it used to be held by care.
 *
 * `testing/orthography.ts` holds the contract as data and says what each rule is for.
 */

/**
 * What is actually written in this language, which is now the whole table.
 *
 * This used to filter down to the guest sections for the four translations, because the
 * rest of an assembled table was French by design and checking `TRANSLATIONS.it` whole
 * would have demanded that "Modération" be spelled in Italian. Nothing is French by
 * design any more, so the filter is gone — and its removal is the point rather than a
 * tidy-up: about 270 keys per language just stopped being exempt from every rule below,
 * which is roughly four fifths of the copy these tests now cover.
 *
 * The extension was a decision and not an inevitability. The alternative — keep the
 * orthography contract French-only, on the grounds that French is the one language whose
 * author actually knows it — was rejected for the reason the contract itself gives: the
 * French copy carries correct accents because whoever wrote it cared, and care is exactly
 * what does not survive being multiplied by five. Nobody reviewing this branch's diff was
 * going to notice `fuer` in the two hundred and seventieth German string. A rule that can
 * be mechanical should be, in every language, and the rules here are the ones that can.
 */
const writtenIn = (locale: Locale): readonly Rendered[] => walkTable(TRANSLATIONS[locale])

const TABLES = SUPPORTED_LOCALES.map((locale): [Locale, readonly Rendered[]] => [
  locale,
  writtenIn(locale),
])

describe.each(TABLES)('%s', (locale, rendered) => {
  it('is normalised, so an accent is one character and not two', () => {
    // NFC or it does not exist. `e` + U+0301 looks exactly like `é` in every editor and
    // in the rendered page, and is a different string to everything that will ever read
    // it — a search, a `grep`, a diff, a test that pins a sentence.
    for (const { path, text } of rendered) {
      expect(text.normalize('NFC'), `${locale}.${path} is not NFC-normalised`).toBe(text)
    }
  })

  it.each(FORBIDDEN)('contains no %s', (pattern, reason) => {
    for (const { path, text } of rendered) {
      expect(pattern.test(text), `${locale}.${path} contains ${reason}`).toBe(false)
    }
  })

  it('writes only the letters this language writes', () => {
    // What stops a copy-paste from the neighbouring table: an `ñ` in German, a `ß` in
    // Italian, a `ç` in Spanish. Each is a single character that reads as a typo and
    // survives every other check in this file.
    const allowed = repertoireFor(locale)
    for (const { path, text } of rendered) {
      for (const character of text) {
        expect(
          allowed.has(character),
          `${locale}.${path} uses ${character} (U+${character.codePointAt(0)?.toString(16).padStart(4, '0').toUpperCase()}), which ${locale} does not write`,
        ).toBe(true)
      }
    }
  })

  it.each(ORTHOGRAPHY[locale].requires)('uses %s somewhere', (characters, reason) => {
    // The coarse alarm, and the one that catches the worst failure: a table that was
    // written by somebody without the right keyboard. Two hundred strings of German
    // with no umlaut in them are not German.
    const everything = rendered.map(({ text }) => text).join('')
    const used = [...characters].some((character) => everything.includes(character))
    expect(used, reason).toBe(true)
  })

  it('spells out characters rather than transliterating them', () => {
    // The per-string version of the rule above. `ueber` is not a German word and is not
    // inside one; `codigo` is not Spanish; `piu` is not Italian. The correctly accented
    // spellings do not match these, because `ü` is not `ue` — and each pattern carries
    // its own boundaries, so a German stem matches inside a word and an Italian word
    // does not.
    for (const { path, text } of rendered) {
      for (const spelling of ORTHOGRAPHY[locale].transliterations) {
        expect(
          spelling.test(text),
          `${locale}.${path} matches ${String(spelling)}, where the accented spelling belongs`,
        ).toBe(false)
      }
    }
  })
})

/**
 * Whether every closing mark has an opener, and every opener starts a clause.
 *
 * Counting the two characters was the first version of this and it was too weak in one
 * direction and too strong in the other. "foto¿ … definitivo?" has one of each and is
 * nonsense, and a `?` inside a URL has no business needing an opener at all. So: scan
 * left to right, every closer must find an opener already waiting, no opener may be left
 * over — and separately, an opener has to sit where a clause begins, which is what tells
 * `¿Eliminar…` from `Eliminar…¿`.
 */
const paired = (text: string, open: string, close: string): boolean => {
  // A URL's query string is not a question. None of the tables carries one today; this
  // is here so that the first one to do so is not met with a spelling failure.
  const prose = text.replace(/\b(?:https?:\/\/|www\.)\S+/gu, '')
  const characters = [...prose]
  let waiting = 0

  for (const [at, character] of characters.entries()) {
    if (character === open) {
      const before = characters[at - 1]
      // Start of the string, or after a space or an opening bracket: the start of a
      // clause. After a letter it is a typo, whatever the counts say.
      if (before !== undefined && !/[\s(«„“—–-]/u.test(before)) return false
      waiting += 1
    } else if (character === close) {
      if (waiting === 0) return false
      waiting -= 1
    }
  }

  return waiting === 0
}

describe('es', () => {
  it('opens every question and every exclamation', () => {
    // The one punctuation rule in this set that is a rule of the language rather than a
    // rule of the keyboard, and the one an English or French speaker writing Spanish
    // forgets every time. The opening mark goes at the start of the *clause*, not of the
    // sentence: "Esto es definitivo, ¿quiere continuar?" has its ¿ in the middle.
    for (const { path, text } of writtenIn('es')) {
      expect(paired(text, '¿', '?'), `es.${path} has a question mark with no ¿ opening it`).toBe(
        true,
      )
      expect(paired(text, '¡', '!'), `es.${path} has an exclamation with no ¡ opening it`).toBe(
        true,
      )
    }
  })
})

describe('the other four', () => {
  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== 'es'))(
    '%s does not borrow Spanish inverted punctuation',
    (locale) => {
      // The mirror of the rule above, and it is not pedantry: `¿` is in the shared
      // repertoire precisely so that Spanish may use it, which means nothing else stops
      // it appearing in a French sentence somebody pasted from the wrong table.
      for (const { path, text } of writtenIn(locale)) {
        expect(/[¿¡]/u.test(text), `${locale}.${path} uses Spanish inverted punctuation`).toBe(
          false,
        )
      }
    },
  )
})
