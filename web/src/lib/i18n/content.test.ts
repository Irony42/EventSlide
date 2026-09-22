import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from './locale'
import { TRANSLATIONS } from './translations'

/**
 * What a person wrote is never translated, in any language.
 *
 * An event's name, a caption, a display name, a mission prompt: they arrive on a DTO and
 * are interpolated **verbatim**, so a German console reads "Les confettis — Foto von Léa"
 * and that is correct — the frame is the product speaking and the words inside it are a
 * guest speaking.
 *
 * It needs a test because the opposite does not look like a bug in review: a table entry
 * that title-cases a name, strips an accent to match a repertoire or "helpfully" shortens
 * a caption reads as care, and it is invisible on a French machine.
 *
 * **The set of content-carrying phrases is not a list somebody maintains**, which is the
 * version of this that rots. `fr.ts` already records which phrases take a person’s words
 * rather than a number, in the parameter type — `(author: string)` against
 * `(count: number)` — so this reads it as source and checks every such phrase in all five
 * languages. A new one is covered the moment it is declared.
 *
 * Reading a path is not an import; `dtoContract.test.ts` uses the same technique for the
 * same reason — the fact exists in the source text and is erased by the time the module
 * runs.
 */

const FRENCH = join(process.cwd(), 'web/src/lib/i18n/fr.ts')

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
 * Every phrase `fr.ts` declares, with the types of its arguments. Descends into the six
 * nested records (`wall.layoutNames`, the five `admin.*Names`): none holds a phrase today,
 * and a top-level-only walk would silently stop covering them if one ever did.
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

const carriesContent = (phrase: Phrase): boolean =>
  phrase.parameters.some(({ type }) => type.includes('string'))

const CONTENT_PHRASES = PHRASES.filter(carriesContent)

/**
 * What goes into a content hole: deliberately awkward, because the point is that nothing
 * may tidy it. Every character here — an accent, an elision apostrophe, an ampersand, a
 * case mixture — is something a well-meaning entry might normalise, and every marker is
 * the shape of a real name. Distinct per position, so a phrase that drops one or swaps
 * two is visible rather than plausible.
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
 * A marker where the phrase takes words, a number where it takes a count, a one-element
 * array where it takes a list — `wall.layoutOrder` calls `.join` on what it is handed, so
 * a bare string would throw and read as a broken test rather than as this check.
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
    // Every assertion below is vacuously true against an empty list, so a change to how
    // `fr.ts` declares its table would otherwise turn this suite green and blind.
    expect(PHRASES.length).toBeGreaterThan(50)
    expect(CONTENT_PHRASES.length).toBeGreaterThan(20)
  })

  it('are spread across the sections that actually render content', () => {
    // A check on the classification rather than on the tables: a `string` parameter that
    // stopped being recognised would shrink this set rather than fail anything below.
    const sections = new Set(CONTENT_PHRASES.map(({ path }) => path.split('.')[0]))

    expect([...sections].sort()).toEqual(
      expect.arrayContaining(['admin', 'join', 'mobileModeration', 'moderation', 'upload', 'wall']),
    )
  })
})

describe.each(SUPPORTED_LOCALES)('%s', (locale) => {
  const table = TRANSLATIONS[locale]

  it('renders what a person wrote exactly as they wrote it', () => {
    for (const phrase of CONTENT_PHRASES) {
      const callable = phraseAt(table, phrase.path)
      // A missing phrase is the compiler's to report and `translations.test.ts`'s to name.
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
    // `(caption, author)` rendered the other way round attributes a photograph to its own
    // caption. Both are `string`, so the compiler cannot see it — and the case above
    // passes, because both markers are present.
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
