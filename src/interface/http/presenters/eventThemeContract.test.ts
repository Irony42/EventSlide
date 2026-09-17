import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  ACCENT_INK_TONE,
  ACCENT_STRONG_TONE,
  ACCENT_TONE,
  CURATED_ACCENT_HUES,
  DEFAULT_EVENT_THEME,
  STATUS_HUES,
  THEME_FONTS,
  THEME_FRAMES,
} from '../../../domain/events/eventTheme'

/**
 * The theming rule, compared against the stylesheet it is a rule about.
 *
 * Roadmap 2.2 put "can the room read this palette" in the domain, where a host can be
 * refused, and left the colours in `tokens.css`, where the design system says every raw
 * value belongs. That split is right and it has one cost: the rule computes a palette the
 * stylesheet renders, from numbers declared twice. Nothing in either build would notice
 * them drifting — the server would go on cheerfully proving that a hue is legible using a
 * lightness the browser stopped using.
 *
 * So this file reads the stylesheet and fails on exactly that. It sits beside
 * `wallLayoutContract.test.ts`, which does the same job in the other direction, and
 * `dtoContract.test.ts`, which does it for the wire. Reading a path is not an import: the
 * architecture rule forbidding `web` to import `src` stands untouched, and nothing here
 * couples the server's build to the web app's.
 *
 * ## What each half is allowed to be the source of
 *
 * `tokens.css` is the source of every **colour**. The domain is the source of the
 * **rule**, and holds the lightness/chroma pairs only because a rule that cannot compute
 * the palette it judges is not a rule. The direction of this test says so: it reads what
 * the browser will load and checks the domain agrees, never the other way round.
 */

const read = (relative: string): string => readFileSync(join(process.cwd(), relative), 'utf8')

const TOKENS = read('web/src/design-system/tokens.css')
const CLIENT_MIRROR = 'web/src/design-system/eventTheme.ts'

/** `--name: oklch(L% C <hue>)`, where the hue may be the variable a theme moves. */
const declaration = (name: string): { l: number; c: number; hue: string } => {
  // The hue is either a literal or the `var(--accent-hue)` a theme moves, and that
  // alternative has to be spelled out: a lazy `[^)]+?` stops at the variable's own
  // closing bracket and matches nothing at all.
  const pattern = new RegExp(
    `${name}:\\s*oklch\\(\\s*([\\d.]+)%\\s+([\\d.]+)\\s+(var\\([^)]*\\)|[\\d.]+)\\s*\\)\\s*;`,
  )
  const found = pattern.exec(TOKENS)
  if (found?.[1] === undefined || found[2] === undefined || found[3] === undefined) {
    throw new Error(`${name} is not an oklch declaration in tokens.css — was it renamed?`)
  }
  return { l: Number(found[1]) / 100, c: Number(found[2]), hue: found[3] }
}

const declaredHue = (): number => {
  const found = /--accent-hue:\s*([\d.]+)\s*;/.exec(TOKENS)
  if (found?.[1] === undefined) throw new Error('tokens.css declares no --accent-hue')
  return Number(found[1])
}

/** Every `[data-event-<attribute>='<value>']` selector the stylesheet defines a block for. */
const themedValues = (attribute: string): readonly string[] => {
  const pattern = new RegExp(`\\[data-event-${attribute}='([a-z-]+)'\\]`, 'g')
  return [...TOKENS.matchAll(pattern)].flatMap(([, value]) => (value === undefined ? [] : [value]))
}

const clientSource = (): ts.SourceFile => {
  const path = join(process.cwd(), CLIENT_MIRROR)
  return ts.createSourceFile(path, read(CLIENT_MIRROR), ts.ScriptTarget.ES2022, true)
}

/** A `const NAME: readonly T[] = ['a', 'b']` in the client mirror, as its strings. */
const clientArray = (name: string): readonly string[] => {
  const source = clientSource()
  const found: string[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        if (ts.isStringLiteral(element)) found.push(element.text)
      }
      return
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(source, visit)
  return found
}

/** An object literal in the client mirror, read out of its source as numbers or strings. */
const clientLiteral = (name: string): ReadonlyMap<string, string> => {
  const source = clientSource()
  const found = new Map<string, string>()

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined
    ) {
      // Unwrap what a declaration may legitimately be wrapped in before the object
      // itself: `as const` for the vocabularies, and `Object.freeze(...)` for the
      // default theme, which is shared by reference across every unthemed surface.
      const unwrap = (node: ts.Expression): ts.Expression => {
        if (ts.isAsExpression(node)) return unwrap(node.expression)
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'freeze' &&
          node.arguments[0] !== undefined
        ) {
          return unwrap(node.arguments[0])
        }
        return node
      }
      const literal = unwrap(node.initializer)
      if (ts.isObjectLiteralExpression(literal)) {
        for (const property of literal.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          found.set(
            property.name.getText(source),
            property.initializer.getText(source).replace(/^'|'$/g, ''),
          )
        }
      }
      return
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(source, visit)
  return found
}

describe('the accent derivation', () => {
  it('starts on the hue tokens.css declares, so an unthemed event is unchanged', () => {
    // The one number that decides whether every committed wall baseline is still valid.
    expect(declaredHue()).toBe(DEFAULT_EVENT_THEME.accentHue)
  })

  it.each([
    ['--accent', ACCENT_TONE],
    ['--accent-strong', ACCENT_STRONG_TONE],
    ['--accent-contrast', ACCENT_INK_TONE],
  ])('%s is declared at the lightness and chroma the rule computes with', (name, tone) => {
    // If these drift, the rule goes on proving a palette legible that the browser has
    // stopped rendering — the one failure neither side's tests can see alone.
    const declared = declaration(name)

    expect(declared.l).toBeCloseTo(tone.l, 6)
    expect(declared.c).toBeCloseTo(tone.c, 6)
  })

  it.each(['--accent', '--accent-strong', '--accent-contrast'])(
    '%s takes its hue from the variable an event moves',
    (name) => {
      // The whole mechanism. A literal hue here would mean a themed event changing the
      // button but not its pressed state, or its label — a half-applied palette.
      expect(declaration(name).hue).toBe('var(--accent-hue)')
    },
  )

  it('re-derives the accent on the element an event’s hue lands on', () => {
    // The rule that makes the mechanism work at all, and the one that is silently wrong
    // when it is missing. A custom property referencing another is resolved on the
    // element it is declared on, so an `--accent` declared only for `:root` keeps the
    // product's hue however far down the tree `--accent-hue` moves — the palette simply
    // never changes, with nothing in any build to say why.
    expect(TOKENS).toMatch(/:root,\s*\[data-event-accent\]\s*\{/)
  })

  it.each(Object.entries(STATUS_HUES))(
    'keeps --%s at the hue the crowding rule measures against',
    (role, hue) => {
      expect(declaration(`--${role}`).hue).toBe(String(hue))
    },
  )
})

describe('the vocabularies a theme selects from', () => {
  it('declares a block for every font pairing except the default', () => {
    // The default is absent on purpose: an event that chose nothing sets no attribute, so
    // a block for it could only ever be dead weight — or worse, a second declaration of
    // the face `:root` already has.
    const themed = THEME_FONTS.filter((value) => value !== DEFAULT_EVENT_THEME.fonts)

    expect([...themedValues('fonts')].sort()).toEqual([...themed].sort())
  })

  it('declares a block for every frame style except the default', () => {
    const themed = THEME_FRAMES.filter((value) => value !== DEFAULT_EVENT_THEME.frame)

    expect([...themedValues('frame')].sort()).toEqual([...themed].sort())
  })
})

describe('the picker the host actually uses', () => {
  it('offers exactly the hues the domain curates', () => {
    // The list is a UI affordance and the rule is the guard, but an option the server
    // refuses would still be a form that cannot be submitted — and a hue the domain
    // curates that never reaches the picker is a decision nobody can make.
    const client = clientLiteral('CURATED_ACCENT_HUES')
    const mirrored = Object.fromEntries([...client].map(([name, hue]) => [name, Number(hue)]))

    expect(mirrored).toEqual(CURATED_ACCENT_HUES)
  })

  it('agrees with the domain about what "no theme" is', () => {
    const client = clientLiteral('DEFAULT_EVENT_THEME')

    expect({
      accentHue: Number(client.get('accentHue')),
      fonts: client.get('fonts'),
      frame: client.get('frame'),
    }).toEqual(DEFAULT_EVENT_THEME)
  })

  it.each([
    ['THEME_FONTS', THEME_FONTS],
    ['THEME_FRAMES', THEME_FRAMES],
  ])('offers exactly the %s the domain accepts', (name, vocabulary) => {
    // The two closed vocabularies. An option in the picker the schema refuses is a
    // control that answers 400 whatever the host does with it, and a value the domain
    // accepts that never reaches the picker is a choice nobody can make.
    expect(clientArray(name)).toEqual([...vocabulary])
  })
})
