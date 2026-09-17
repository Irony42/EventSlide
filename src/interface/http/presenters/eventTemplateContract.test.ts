import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { EventSettings } from '../../../domain/events/eventSettings'
import {
  EVENT_TEMPLATE_KEYS,
  eventTemplatePatch,
  type EventTemplateKey,
} from '../../../domain/events/eventTemplate'

/**
 * The four presets, compared against the client's copy of them.
 *
 * Roadmap 3.5 put the catalogue in the domain, where it is versioned with the code and
 * costs no table, and the host's create form has to **show** what each preset does before
 * a host picks one — which means the same four sets of values exist twice, in two builds
 * that share no import. Nothing in either would notice them drifting: the card would go
 * on promising a year of retention for a template that had been changed to a month, on
 * the one screen whose entire job is telling a host what they are about to agree to.
 *
 * So this reads the client's table out of its source and fails on exactly that. It sits
 * beside `eventThemeContract.test.ts`, which does the same for the palette, and
 * `wallLayoutContract.test.ts`, which does it for the layout table. Reading a path is not
 * an import: the architecture rule forbidding `web` to import `src` stands untouched.
 *
 * ## Direction
 *
 * The domain is the source. The client is the copy, and this test says so by comparing
 * the copy to it rather than the other way round — a template is a product decision about
 * what a wedding needs, and a form is where it is displayed.
 *
 * ## Why not put them on the wire instead
 *
 * Four fixed constants would then cost a round trip on a form that has not been submitted
 * yet, plus an endpoint, a DTO and a docs entry — and the client would still need a
 * fallback for the request that fails. A mirror plus this file is what this repository
 * already does with every other fact of this shape.
 */

const CLIENT_MIRROR = 'web/src/features/admin/eventTemplates.ts'

const source = (): ts.SourceFile => {
  const path = join(process.cwd(), CLIENT_MIRROR)
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true)
}

/**
 * A JSON-ish value out of a TypeScript literal.
 *
 * Deliberately narrow: strings, numbers, booleans, `null` and nested object literals are
 * the whole vocabulary a settings patch can be written in, and anything else throws
 * rather than being quietly read as `undefined`. A mirror that had grown a computed value
 * would be invisible to a lenient reader, which is the one failure this file exists to
 * catch.
 */
const literal = (node: ts.Node, file: ts.SourceFile): unknown => {
  // `as const`, `satisfies X` and `as const satisfies X` are this repository's house
  // style for exactly this kind of table — `CURATED_ACCENT_HUES` and `STATUS_HUES` are
  // both written that way. Unwrapping them is not leniency: the literal underneath is
  // still read strictly, and refusing them would mean the next person harmonising the
  // mirror with its neighbours got "is not a plain literal" instead of a drift report.
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return literal(node.expression, file)
  }
  if (ts.isParenthesizedExpression(node)) return literal(node.expression, file)
  if (ts.isStringLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {}
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error(`${CLIENT_MIRROR}: a spread or shorthand cannot be compared`)
      }
      value[property.name.getText(file).replace(/^'|'$/g, '')] = literal(property.initializer, file)
    }
    return value
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => literal(element, file))
  }
  throw new Error(`${CLIENT_MIRROR}: ${node.getText(file)} is not a plain literal`)
}

/**
 * The initializer of the `const <name> = …` in the mirror.
 *
 * The walk is the whole tree, not the top level — a declaration nested in a block or a
 * function is found too. It stops at the **first** match rather than letting a later one
 * overwrite it, because a second `const` of the same name is a file this test can no
 * longer describe, and silently comparing against whichever came last is how a mirror
 * gets a shadowing copy nobody notices.
 */
const declared = (name: string): unknown => {
  const file = source()
  // An array rather than a nullable, because a value assigned inside a closure is not
  // something the compiler will narrow afterwards — `found` would be `never` at the
  // return, and the only ways out are a cast or this.
  const found: { value: unknown }[] = []

  const visit = (node: ts.Node): void => {
    if (found.length > 0) return
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined
    ) {
      found.push({ value: literal(node.initializer, file) })
      return
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(file, visit)
  const first = found[0]
  if (first === undefined) throw new Error(`${CLIENT_MIRROR} declares no ${name} — was it renamed?`)
  return first.value
}

describe('the template catalogue the host’s create form shows', () => {
  it('offers exactly the templates the domain holds, in the same order', () => {
    // Order is part of it: the picker renders this array, so a reordering here would move
    // the options under a host who has used the form before.
    expect(declared('EVENT_TEMPLATE_KEYS')).toEqual([...EVENT_TEMPLATE_KEYS])
  })

  it.each(EVENT_TEMPLATE_KEYS)('describes %s with the values the server will apply', (key) => {
    // The assertion this file exists for. The card lists what the template changes, and a
    // card that lists a value the server does not apply is a promise to a host made on
    // their behalf by a stale copy.
    const mirror = declared('EVENT_TEMPLATE_PATCHES')
    expect(mirror).toBeTypeOf('object')

    const patches = mirror as Record<EventTemplateKey, unknown>

    expect(patches[key]).toEqual(eventTemplatePatch(key))
  })

  it('claims no template the domain does not have', () => {
    const patches = declared('EVENT_TEMPLATE_PATCHES') as Record<string, unknown>

    expect(Object.keys(patches).sort()).toEqual([...EVENT_TEMPLATE_KEYS].sort())
  })

  it('reads a table written in the repository’s own `as const satisfies` style', () => {
    // Not a hypothetical. `CURATED_ACCENT_HUES` and `STATUS_HUES` next door are both
    // written that way, so somebody harmonising the mirror with its neighbours is one
    // plausible edit from a parser that threw "is not a plain literal" — a confusing
    // failure in place of the drift report this file exists to give.
    const wrapped = ts.createSourceFile(
      'mirror.ts',
      'const TABLE = { wedding: { retentionDays: 365 } } as const satisfies Record<string, unknown>',
      ts.ScriptTarget.ES2022,
      true,
    )
    const declaration = wrapped.statements[0]
    if (declaration === undefined || !ts.isVariableStatement(declaration)) {
      throw new Error('the fixture above is not a variable statement')
    }
    const initializer = declaration.declarationList.declarations[0]?.initializer
    if (initializer === undefined) throw new Error('the fixture above has no initializer')

    expect(literal(initializer, wrapped)).toEqual({ wedding: { retentionDays: 365 } })
  })
})

/**
 * The defaults the **"Sans modèle"** card names out loud.
 *
 * That option is pre-selected and its sentence is the only one on the form not rendered
 * from a table, because there is no patch to render — "no template" is the absence of
 * one. So it is hand-written French asserting two facts about the domain, which is
 * exactly the shape of claim that goes quietly stale. A default changed here without the
 * copy is a create form telling a host their photographs are kept indefinitely when they
 * are not, or the reverse.
 */
describe('the defaults the “Sans modèle” option promises', () => {
  it('keeps everything, which is what "conservation illimitée" says', () => {
    expect(EventSettings.default().retentionDays).toBeNull()
  })

  it('validates every photo, which is what "chaque photo validée" says', () => {
    expect(EventSettings.default().moderation).toBe('manual')
  })
})
