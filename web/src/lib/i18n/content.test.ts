import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from './locale'
import { TRANSLATIONS } from './translations'

/**
 * What a person wrote is never translated, in any language, and this is what makes that
 * mechanical rather than remembered.
 *
 * ## The rule
 *
 * An event's name, a photograph's caption, a guest's display name, a mission's prompt, a
 * moderator's e-mail address, an event's slug: a person typed those, in whatever language
 * they were speaking, and no table has an entry for them. They arrive on a DTO and are
 * interpolated into a sentence **verbatim**.
 *
 * So the wall routinely prints a translated heading over untranslated prompts, and a
 * German moderation console reads "Les confettis — Foto von Léa". That is correct rather
 * than a defect: the frame is the product speaking and the words inside it are a guest
 * speaking, and they are allowed to be in different languages because they are different
 * voices. §2.1 already says this to the host, in the hint under the prompt field:
 * "écrite dans la langue de la soirée : elle n'est pas traduite".
 *
 * ## Why it needs a test and not a comment
 *
 * A translation pass over eleven sections in five languages is exactly the change that
 * produces the opposite. The failure does not look like a bug in review — a table entry
 * that title-cases a name, strips an accent to match a repertoire, wraps a prompt in a
 * lookup, or "helpfully" shortens a caption reads as care — and it is invisible on a
 * French machine, because French is where the content and the interface agree.
 *
 * ## How the set of content-carrying phrases is found
 *
 * Not from a list somebody maintains, which is the version of this that rots. `fr.ts` is
 * the source of truth for what keys exist, and it is also the source of truth for which
 * of them take **a person's words rather than a number**: the difference is written down
 * in the French declaration as a parameter type. `(author: string) => …` carries content;
 * `(count: number) => …` does not.
 *
 * So this reads `fr.ts` as source, finds every phrase with a `string` parameter, and
 * checks that phrase in **all five** languages. A new content-carrying phrase is covered
 * the moment it is declared, and nobody has to remember anything.
 *
 * Reading a path is not an import: this is the same technique
 * `src/interface/http/presenters/dtoContract.test.ts` uses, for the same reason — the
 * fact being checked exists in the source text and is erased by the time the module runs.
 */

const FRENCH = join(process.cwd(), 'web/src/lib/i18n/fr.ts')

/** One argument a phrase declares, at the position it declares it. */
interface Parameter {
  readonly at: number
  /** `string`, `number`, `readonly string[]` — the text of the annotation. */
  readonly type: string
}

interface Phrase {
  readonly path: string
  readonly parameters: readonly Parameter[]
}

/**
 * Every phrase `fr.ts` declares, with the types of its arguments.
 *
 * Walks property assignments so the six nested records (`wall.layoutNames` and the five
 * `admin.*Names`) are descended into rather than skipped — none of them holds a phrase
 * today, and a walk that stopped at the top level would silently stop covering them if
 * one ever did.
 */
const phrasesOf = (source: ts.SourceFile): readonly Phrase[] => {
  const found: Phrase[] = []

  const walkObject = (object: ts.ObjectLiteralExpression, prefix: string): void => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const name = ts.isStringLiteral(property.name)
        ? property.name.text
        : property.name.getText(source)
      const path = prefix === '' ? name : `${prefix}.${name}`

      // `satisfies Record<…>` wraps the literal, so unwrap before descending.
      const value = ts.isSatisfiesExpression(property.initializer)
        ? property.initializer.expression
        : property.initializer

      if (ts.isArrowFunction(value)) {
        found.push({
          path,
          parameters: value.parameters.map((parameter, at) => ({
            at,
            type: parameter.type?.getText(source) ?? 'unknown',
          })),
        })
        continue
      }

      if (ts.isObjectLiteralExpression(value)) walkObject(value, path)
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'fr' &&
      node.initializer !== undefined
    ) {
      const literal = ts.isAsExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer
      if (ts.isObjectLiteralExpression(literal)) walkObject(literal, '')
      return
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(source, visit)
  return found
}

const french = ts.createSourceFile(
  FRENCH,
  readFileSync(FRENCH, 'utf8'),
  ts.ScriptTarget.ES2022,
  true,
)

const PHRASES = phrasesOf(french)

/** A phrase carries content when at least one of its arguments is somebody's words. */
const carriesContent = (phrase: Phrase): boolean =>
  phrase.parameters.some(({ type }) => type.includes('string'))

const CONTENT_PHRASES = PHRASES.filter(carriesContent)

/**
 * What goes into a content hole.
 *
 * Deliberately awkward, because the point is that nothing may tidy it: a lower-cased
 * letter, an accent, an elision apostrophe, an ampersand, a hyphen and a case mixture.
 * Every one of those is something a well-meaning table entry might normalise, and every
 * one of them is a real guest's name or a real event's title — `Camille & Sacha` is the
 * example `fr.ts` itself uses.
 *
 * Distinct per position, so a phrase that interpolates the same argument twice, drops
 * one, or swaps two is visible rather than plausible.
 */
const MARKERS: readonly string[] = [
  'Lé-Ann O’Hara & Cie',
  'Æthel ÖZTÜRK-dos Santos',
  'sœur d’un ami — 3ᵉ rang',
  'ça ira, ça ira',
]

/** A phrase, once its parameter types are known. Only the tables ever build these. */
type Callable = (...args: readonly unknown[]) => string

const phraseAt = (table: object, path: string): Callable | null => {
  const found = path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        typeof node === 'object' && node !== null ? Reflect.get(node, key) : undefined,
      table,
    )
  return typeof found === 'function' ? (found as Callable) : null
}

/**
 * The arguments to call a phrase with: a marker where it takes words, a number where it
 * takes a count, and a one-element array where it takes a list.
 *
 * `wall.layoutOrder` is the list case and it is why this exists rather than a flat spread
 * of strings: it calls `.join` on what it is handed, so a bare string would throw and the
 * failure would read as a broken test rather than as the check it is.
 */
const argumentsFor = (phrase: Phrase): readonly unknown[] =>
  phrase.parameters.map(({ at, type }) => {
    if (!type.includes('string')) return 100 + at
    const marker = MARKERS[at % MARKERS.length] ?? MARKERS[0]
    return type.includes('[]') ? [marker] : marker
  })

/** The markers a call should have put into the sentence, in declaration order. */
const expectedMarkers = (phrase: Phrase): readonly string[] =>
  phrase.parameters
    .filter(({ type }) => type.includes('string'))
    .map(({ at }) => MARKERS[at % MARKERS.length] ?? MARKERS[0])
    .filter((marker): marker is string => marker !== undefined)

describe('the phrases that carry a person’s words', () => {
  it('were found in fr.ts at all', () => {
    // Every assertion below is vacuously true against an empty list, so the parser has to
    // prove it still understands the file it reads: a change to how `fr.ts` declares its
    // table — an `as const` moved, a `satisfies` added, the export renamed — would
    // otherwise turn this whole suite green and blind.
    expect(PHRASES.length).toBeGreaterThan(50)
    expect(CONTENT_PHRASES.length).toBeGreaterThan(20)
  })

  it('are spread across the sections that actually render content', () => {
    // A sanity check on the classification rather than on the tables. The four surfaces
    // that interpolate somebody's words are the guest's join screen, the guest's mission
    // list, the moderation consoles and the wall — plus the host's own console, which
    // echoes event names, slugs and e-mail addresses back at them.
    const sections = new Set(CONTENT_PHRASES.map(({ path }) => path.split('.')[0]))

    expect([...sections].sort()).toEqual(
      expect.arrayContaining(['admin', 'join', 'mobileModeration', 'moderation', 'upload', 'wall']),
    )
  })
})

describe.each(SUPPORTED_LOCALES)('%s', (locale) => {
  const table = TRANSLATIONS[locale]

  it('renders what a person wrote exactly as they wrote it', () => {
    // The rule, in every language including French. What is being checked is not that the
    // sentence is right — that is `translations.test.ts`'s job — but that the words handed
    // in come back out unchanged: not lower-cased, not stripped of accents, not truncated,
    // not escaped, and above all not looked up in anything.
    for (const phrase of CONTENT_PHRASES) {
      const callable = phraseAt(table, phrase.path)
      // A missing phrase is the compiler's failure to report and `translations.test.ts`'s
      // to name; skipping keeps this file's failures about content.
      if (callable === null) continue

      const rendered = callable(...argumentsFor(phrase))

      for (const marker of expectedMarkers(phrase)) {
        expect(
          rendered,
          [
            `web/src/lib/i18n/${locale}.ts — ${phrase.path} did not render what it was handed.`,
            `It was given «${marker}» and produced «${rendered}».`,
            'An event name, a caption, a display name and a mission prompt are content: a',
            'person wrote them, in the language they were speaking, and no table translates,',
            'reformats or normalises them. Interpolate the argument and nothing else.',
          ].join(' '),
        ).toContain(marker)
      }
    }
  })

  it('puts a person’s words in the same place in the sentence as French does', () => {
    // The order matters for the same reason it matters for numbers, and rather more: a
    // phrase taking `(caption, author)` that renders them the other way round attributes a
    // photograph to its own caption. The compiler cannot see it — both are `string` — and
    // the test above would pass, because both markers are present.
    for (const phrase of CONTENT_PHRASES) {
      if (expectedMarkers(phrase).length < 2) continue
      const callable = phraseAt(table, phrase.path)
      if (callable === null) continue

      const rendered = callable(...argumentsFor(phrase))
      const positions = expectedMarkers(phrase).map((marker) => rendered.indexOf(marker))

      expect(
        positions,
        `web/src/lib/i18n/${locale}.ts — ${phrase.path} reorders the values it is given`,
      ).toEqual([...positions].sort((left, right) => left - right))
    }
  })
})
