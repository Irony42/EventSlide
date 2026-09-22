import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { DEFAULT_EVENT_LANGUAGE, EVENT_LANGUAGES } from '../../../domain/events/eventLanguage'

/**
 * One vocabulary, declared three times, compared here.
 *
 * `wallLanguage` is the only field on the wire whose value the **client** must have a
 * table for. Every other enum here is a token the browser switches on, and an unknown one
 * is at worst an unstyled corner; a server accepting `pt` puts a projector on a language
 * this build has no words for, and `withFrenchFallback` renders the whole wall in French
 * with nothing saying why while the host's settings page shows their choice saved.
 *
 * The three that must agree are the domain's `EVENT_LANGUAGES`, the wire's
 * `EventLanguage` and `locale.ts`'s `SUPPORTED_LOCALES` — the last being the one that
 * decides whether a tag renders anything. None may import the others, so this compares
 * source text, as `wallLayoutContract.test.ts` and `dtoContract.test.ts` do.
 */

const LOCALE = join(process.cwd(), 'web/src/lib/i18n/locale.ts')
const DTO = join(process.cwd(), 'web/src/lib/api/dto.ts')

const sourceOf = (path: string): ts.SourceFile =>
  ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true)

/** The string literals of a `const X = [...] as const` array, by variable name. */
const constArray = (source: ts.SourceFile, name: string): readonly string[] => {
  const found: string[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      const initialiser = ts.isAsExpression(node.initializer ?? node)
        ? (node.initializer as ts.AsExpression).expression
        : node.initializer
      if (initialiser !== undefined && ts.isArrayLiteralExpression(initialiser)) {
        for (const element of initialiser.elements) {
          if (ts.isStringLiteral(element)) found.push(element.text)
        }
      }
      return
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(source, visit)
  return found
}

/** The members of a `type X = 'a' | 'b'` union, by type-alias name. */
const unionMembers = (source: ts.SourceFile, name: string): readonly string[] => {
  const found: string[] = []

  for (const statement of source.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== name) continue
    const members = ts.isUnionTypeNode(statement.type) ? statement.type.types : [statement.type]
    for (const member of members) {
      if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
        found.push(member.literal.text)
      }
    }
  }

  return found
}

const supportedLocales = constArray(sourceOf(LOCALE), 'SUPPORTED_LOCALES')
const defaultLocale = (): string | null => {
  let found: string | null = null

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'DEFAULT_LOCALE' &&
      node.initializer !== undefined
    ) {
      // `'fr' satisfies Locale`, so the literal is one level in.
      const expression = ts.isSatisfiesExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer
      if (ts.isStringLiteral(expression)) found = expression.text
      return
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(sourceOf(LOCALE), visit)
  return found
}

const wireLanguages = unionMembers(sourceOf(DTO), 'EventLanguage')

describe('the language vocabulary', () => {
  it('found all three declarations at all', () => {
    // Every assertion below is vacuously true against an empty list, so a rename or a
    // change from a union to an enum would otherwise turn this suite green and blind.
    expect(EVENT_LANGUAGES.length).toBeGreaterThanOrEqual(2)
    expect(supportedLocales.length).toBe(EVENT_LANGUAGES.length)
    expect(wireLanguages.length).toBe(EVENT_LANGUAGES.length)
  })

  it('the domain accepts exactly the languages the app has tables for', () => {
    expect([...EVENT_LANGUAGES].sort()).toEqual([...supportedLocales].sort())
  })

  it('the wire carries exactly the same set', () => {
    expect([...wireLanguages].sort()).toEqual([...EVENT_LANGUAGES].sort())
  })

  it('the two halves fall back to the same language', () => {
    // If these disagreed, an event created through the API with no language would render
    // one thing on the wall and another everywhere the client defaults.
    expect(DEFAULT_EVENT_LANGUAGE).toBe(defaultLocale())
  })
})
