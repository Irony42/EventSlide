import { describe, expect, it } from 'vitest'
import { formattersFor } from './formatters'
import { fr } from './fr'
import { SUPPORTED_LOCALES, type Locale } from './locale'
import { TRANSLATIONS, messageForCode, withFrenchFallback, type UiText } from './translations'
import { walkTable } from './testing/walkTable'

/** Every section of the table, read off the source of truth rather than listed here. */
const SECTIONS = Object.keys(fr) as readonly (keyof typeof fr)[]

/**
 * What every table has to be true of, whatever language it is in.
 *
 * The compiler already guarantees the *keys*: a locale table is typed from `typeof fr`,
 * so a missing key, an extra key, an invented section or a phrase whose arguments drifted
 * all fail `npm run typecheck`. Four cases at the bottom of this file prove that by
 * asserting the compiler rejects them.
 *
 * What the compiler cannot see is whether a key holds something worth rendering. An
 * empty string types fine, so does a key name copied into its own value, and both of
 * them reach a guest's phone as nothing at all. That is what the rest of this checks.
 */

const LOCALISED = SUPPORTED_LOCALES.map((locale): [Locale, ReturnType<typeof walkTable>] => [
  locale,
  walkTable(TRANSLATIONS[locale]),
])

describe.each(LOCALISED)('%s', (locale, rendered) => {
  it('renders something for every key', () => {
    // The fallback rule, from the reader's side: never an empty string, never a string
    // of spaces, and never `undefined` rendered as text. A phrase that produced any of
    // those would be a blank button on a phone.
    for (const { path, text } of rendered) {
      expect(text.trim(), `${locale}.${path} is blank`).not.toBe('')
      expect(text, `${locale}.${path} rendered an absent value`).not.toContain('undefined')
    }
  })

  it('never renders a key name instead of a sentence', () => {
    // The other way a missing translation shows up: the tooling that produced the table
    // filled the value with its own key. It is worse than an empty string, because it
    // looks deliberate.
    for (const { path, text } of rendered) {
      const key = path.split('(')[0] ?? path
      expect(text, `${locale}.${path} rendered its own key`).not.toBe(key)
      expect(text, `${locale}.${path} rendered its own key`).not.toBe(key.split('.').pop())
    }
  })

  it('formats its numbers with its own locale, not with somebody else’s', () => {
    // `const t = formattersFor('fr')` pasted into `de.ts` is a one-word mistake that
    // compiles, reviews cleanly and gives German French grouping and French plural
    // rules — "0 Foto" where German wants "0 Fotos", and a thin space where a full stop
    // belongs. Nothing else in this file would notice: the sentences are all German.
    //
    // A percentage at a thousand is the cheapest thing that tells all five apart:
    // "1 000 %", "1.000 %", "1,000%", "1000 %", "1.000%". `ui.percent` is the only entry
    // that reaches `Intl` for its whole output, so it is the one that can be compared
    // against the formatters the table should have been built with.
    expect(TRANSLATIONS[locale].ui.percent(1000)).toBe(formattersFor(locale).percent(1000))
  })

  it('carries every section', () => {
    expect(Object.keys(TRANSLATIONS[locale]).sort()).toEqual(Object.keys(fr).sort())
  })
})

describe('the scope', () => {
  it('is every section fr.ts declares, with nothing exempt', () => {
    // The reversal, pinned so it cannot quietly un-reverse itself: reintroducing an
    // exempt half means deleting this test, which a reviewer can see.
    expect([...SECTIONS].sort()).toEqual(
      [
        'admin',
        'app',
        'auth',
        'errors',
        'join',
        'mobileModeration',
        'moderation',
        'shell',
        'ui',
        'upload',
        'wall',
      ].sort(),
    )
  })

  it('leaves no section reading as another language’s', () => {
    // A section pasted across and not yet worked on looks perfect to the compiler.
    //
    // **Every pair, not just against French.** Comparing only with French left the
    // language a translator is most likely to be working *from* wide open: an English
    // `auth` section pasted into `it.ts` passed the whole suite, because English letters
    // are in the shared repertoire and English is not French.
    //
    // Compared over the plain sentences only. A phrase is compared through `Intl`, and
    // `percent(80)` is "80 %" in French and in German for reasons that have nothing to
    // do with whether anybody translated anything.
    const sentences = (table: object, section: string) =>
      walkTable(table).filter(({ path }) => path.startsWith(`${section}.`) && !path.includes('('))

    for (const locale of SUPPORTED_LOCALES) {
      for (const other of SUPPORTED_LOCALES) {
        if (other === locale) continue
        for (const section of SECTIONS) {
          const theirs = sentences(TRANSLATIONS[other], section)
          const ours = sentences(TRANSLATIONS[locale], section)
          const identical = ours.filter((entry, index) => entry.text === theirs[index]?.text)
          // Not zero: "Collage", "Polaroid", "Notifications" and "Optional" are the same
          // word in more than one of the five. Measured across all twenty pairs, the worst
          // honest ratio is 0.25.
          expect(
            identical.length / ours.length,
            `${locale}.${section} reads as ${other}.${section} — it was pasted and not translated`,
          ).toBeLessThan(0.5)
        }
      }
    }
  })

  it('lays French under a translation all the way down, not only at the top', () => {
    // Six entries are nested records, and a one-level merge would replace each whole —
    // `undefined` in the shortcuts dialog a host opens at a projector, which is the
    // least-visited screen and so the one a hole hides in longest. Built by hand because
    // the case guarded is a table that does not have the key.
    const partial = {
      ...TRANSLATIONS.de,
      wall: {
        ...TRANSLATIONS.de.wall,
        layoutNames: { spotlight: 'Vollbild' },
      },
    } as unknown as UiText

    const merged = withFrenchFallback(partial)

    expect(merged.wall.layoutNames.spotlight).toBe('Vollbild')
    expect(merged.wall.layoutNames.mosaic).toBe(fr.wall.layoutNames.mosaic)
    expect(merged.wall.layoutNames.split).toBe(fr.wall.layoutNames.split)
    expect(merged.wall.missionsTitle).toBe(TRANSLATIONS.de.wall.missionsTitle)
  })
})

describe('messageForCode', () => {
  it('answers in the language it was given', () => {
    const french = messageForCode('event.notFound', TRANSLATIONS.fr)
    const german = messageForCode('event.notFound', TRANSLATIONS.de)

    expect(german).not.toBe(french)
  })

  it.each(SUPPORTED_LOCALES)('falls back to a generic sentence in %s', (locale) => {
    // A newer server may answer with a code this build has never heard of. The guest
    // gets a sentence in their own language rather than `event.somethingNew`, and
    // rather than a French one.
    const text = TRANSLATIONS[locale]
    expect(messageForCode('event.somethingNew', text)).toBe(text.errors.unknown)
    expect(messageForCode(undefined, text)).toBe(text.errors.unknown)
    expect(messageForCode('constructor', text)).toBe(text.errors.unknown)
  })
})

/**
 * The compiler is the guard, and these four cases are the proof of it.
 *
 * `@ts-expect-error` is an assertion in the other direction: the build fails if the line
 * below it *stops* being an error. So if somebody loosens `UiText` — widens a type, adds
 * an index signature, gives up on the excess-property check — these stop reporting and
 * `npm run typecheck` says so.
 *
 * They run as a test as well so that the file is not mistaken for dead code, but the
 * real assertion happens at compile time.
 */
describe('the type of a locale table', () => {
  it('rejects a table that is missing a key the French one has', () => {
    const { language: _language, ...appWithoutLanguage } = TRANSLATIONS.en.app
    // @ts-expect-error `app.language` exists in fr.ts, so a table without it is incomplete.
    const incomplete: UiText = { ...TRANSLATIONS.en, app: appWithoutLanguage }
    expect(incomplete.app).toBeDefined()
  })

  it('rejects a table carrying a key the French one does not have', () => {
    // Written inline rather than through a variable, because that is what excess
    // property checking needs to see — and it is also how a translator would actually
    // add the key.
    const extra: UiText = {
      ...TRANSLATIONS.en,
      // @ts-expect-error `app.welcomeBanner` is not a key of fr.app.
      app: { ...TRANSLATIONS.en.app, welcomeBanner: 'Hello' },
    }
    expect(extra.app).toBeDefined()
  })

  it('rejects a table carrying a section the French one does not have', () => {
    // This used to assert the opposite — that `admin` was *not* in scope. The scope is
    // the whole table now, so what is left to refuse is an invented section.
    const invented: UiText = {
      ...TRANSLATIONS.en,
      // @ts-expect-error `onboarding` is not a section of fr.ts.
      onboarding: { title: 'Welcome' },
    }
    expect(invented.app).toBeDefined()
  })

  it('rejects a phrase whose parameter types drifted from the French one', () => {
    const wrongShape = { ...TRANSLATIONS.en.join, welcome: (guests: number) => `Welcome ${guests}` }
    // @ts-expect-error `join.welcome` takes the event's name, not a count.
    const drifted: UiText = { ...TRANSLATIONS.en, join: wrongShape }
    expect(drifted.join).toBeDefined()
  })
})

/**
 * The one drift the compiler is structurally unable to see.
 *
 * TypeScript assigns `() => string` to `(name: string) => string` deliberately: a
 * callback may ignore what it is handed, and every `array.map(x => …)` in the language
 * depends on that. The cost here is that a translator can declare a phrase with fewer
 * parameters than French gives it, and the build stays green while the sentence quietly
 * loses a number — `clipHint` without its megabyte limit is a guest filming a video that
 * will be refused, told only how many seconds they had.
 *
 * So the arity is compared at runtime, over every phrase in the table — it covered the
 * guest scope alone until this branch, and thirty-eight of the phrases it now reaches
 * belong to the two consoles that decide what a room sees.
 */
describe('the shape of every phrase', () => {
  /**
   * A phrase, with every argument a **one-element array** — `walkTable`'s trick, for its
   * reason: `wall.layoutOrder` calls `.join` on what it is handed, and `[2]` satisfies
   * every parameter in these tables (it interpolates as "2", `Intl` formats and pluralises
   * on 2, and it has `.join`). That phrase was out of scope until `wall` was translated.
   */
  type Phrase = (...args: readonly (readonly [number])[]) => string

  const phrasesOf = (table: object, prefix = ''): ReadonlyMap<string, Phrase> => {
    const found = new Map<string, Phrase>()
    for (const key of Object.keys(table)) {
      const path = prefix === '' ? key : `${prefix}.${key}`
      const value: unknown = Reflect.get(table, key)
      if (typeof value === 'function') found.set(path, value as Phrase)
      else if (typeof value === 'object' && value !== null) {
        for (const [nested, phrase] of phrasesOf(value, path)) found.set(nested, phrase)
      }
    }
    return found
  }

  const french = phrasesOf(fr)

  /**
   * The message is written for the person who will actually see it: a translator, months
   * from now, who added a parameter in `fr.ts` or dropped one in their own table and has
   * a green typecheck telling them everything is fine. So it names the file to open, the
   * key inside it, and the signature it has to match — not "expected 1 to be 2".
   */
  const signatureOf = (path: string): string => {
    const phrase = path
      .split('.')
      .reduce<unknown>(
        (node, key) =>
          typeof node === 'object' && node !== null ? Reflect.get(node, key) : undefined,
        fr,
      )
    if (typeof phrase !== 'function') return path
    // The French declaration, read off the source. Parameter *names* are what makes the
    // message actionable — "it must be clipHint(seconds, megabytes)" is a instruction,
    // "it must take 2 parameters" is a puzzle.
    const source = phrase.toString()
    const open = source.indexOf('(')
    const close = source.indexOf(')')
    return open === -1 || close === -1 ? path : `${path}(${source.slice(open + 1, close)})`
  }

  it.each(SUPPORTED_LOCALES)('takes the same arguments in %s as in French', (locale) => {
    const other = phrasesOf(TRANSLATIONS[locale])

    for (const [path, phrase] of french) {
      const arity = phrase.length
      const found = other.get(path)?.length
      expect(
        found,
        `web/src/lib/i18n/${locale}.ts has no phrase at ${path}; fr.ts declares one`,
      ).toBeDefined()
      expect(
        found,
        [
          `web/src/lib/i18n/${locale}.ts — ${path} declares ${String(found)} parameter(s)`,
          `where fr.ts declares ${arity}: it must be ${signatureOf(path)}.`,
          'TypeScript accepts a phrase that takes fewer arguments than it is given, so the',
          'build stayed green and the missing value is silently dropped out of the sentence.',
        ].join(' '),
      ).toBe(arity)
    }
  })

  it('has phrases to compare, so the case above cannot pass by finding nothing', () => {
    // Was 15 while only the guest's phrases were walked. A floor a shrunken scope still
    // clears is a floor that stopped guarding anything.
    expect(french.size).toBeGreaterThan(50)
  })

  /**
   * Three digits each, none a substring of another, all below the grouping threshold so
   * every locale formats them as themselves. That last property is what makes searching
   * the rendered sentence for them meaningful at all: 1000 comes out as "1 000" in
   * French and "1.000" in German, and neither contains "1000".
   */
  const MARKERS: readonly number[] = [731, 842, 953, 264]

  /** Which of a phrase's arguments reach the sentence, in order of appearance. */
  const appearances = (phrase: Phrase): readonly number[] => {
    const used = MARKERS.slice(0, Math.max(phrase.length, 1))
    const text = phrase(...used.map((marker): readonly [number] => [marker]))
    return used
      .map((marker) => ({ marker, at: text.indexOf(String(marker)) }))
      .filter(({ at }) => at !== -1)
      .sort((left, right) => left.at - right.at)
      .map(({ marker }) => marker)
  }

  /**
   * The gap the arity check leaves open, and the reason the walker's probes are distinct.
   *
   * Two same-typed parameters can be *swapped* without changing the arity or the types,
   * so the compiler and the arity case both stay green while a German `clipHint` reading
   * `(megabytes, seconds)` tells a guest they may film eighty seconds and send fifteen
   * megabytes. What is mechanically visible is the order the values reach the sentence.
   *
   * Two things are asserted here, and the second is a constraint on translations rather
   * than a law of language. Every declared argument must appear at all — a phrase that
   * keeps a parameter to satisfy the arity check and drops it from the text is the same
   * defect wearing a disguise. And the arguments must appear in the order French puts
   * them: only two guest phrases take more than one argument today and all five tables
   * agree on their order, so the constraint costs nothing now, and a language that
   * genuinely needs the other order should fail this and have somebody decide — a far
   * better outcome than a number landing silently in the wrong half of a sentence.
   *
   * A swap between two arguments a language legitimately reorders is only closable with
   * branded parameter types in `fr.ts`, which is a change to every declaration and every
   * call site and is not worth it for two phrases.
   */
  it.each(SUPPORTED_LOCALES)('uses every argument it declares in %s, in order', (locale) => {
    const other = phrasesOf(TRANSLATIONS[locale])

    for (const [path, phrase] of french) {
      const counterpart = other.get(path)
      if (counterpart === undefined) continue
      // French's own behaviour is the expectation, not a rule invented here:
      // `clipQueueFullRetry` drops its count in the branch it takes for one second, and
      // every table is entitled to do the same.
      expect(
        appearances(counterpart),
        [
          `web/src/lib/i18n/${locale}.ts — ${path} puts its arguments in a different order`,
          'than fr.ts, or leaves one out of the sentence entirely. The arguments are',
          'positional, so a reordered phrase reads a number into the wrong half of its own',
          'sentence, and neither the compiler nor the arity check above can see it.',
        ].join(' '),
      ).toEqual(appearances(phrase))
    }
  })
})
