import { describe, expect, it } from 'vitest'
import { withoutComments } from '../testing/withoutComments'

/**
 * Every token `tokens.css` declares is used by something — the source, read.
 *
 * A token is a promise that a role exists: `--focus-offset` said the focus ring stands off
 * its element, and `--shadow-sm` that elevation has a smallest step. Neither was true, and
 * both stayed in the file and in DESIGN-SYSTEM.md's listing because nothing counts. A
 * declared token no stylesheet, component or other token refers to is deleted, or used.
 *
 * A reference is `--name` followed by something that is not part of a name, in any
 * stylesheet or production module under `web/src`, tokens.css itself included (one token
 * made of another is a use of it). A test that names a token does not use it, and neither does
 * a comment. A token whose name is built by a template (`var(--space-${n})`) is not seen and
 * is flagged: spell the names out.
 *
 * Read as text rather than imported, for the reason `classNames.guard.test.ts` is: no
 * behaviour tells a token that is used from one that is not.
 */

const SOURCES = import.meta.glob<string>('../**/*.{css,ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Glob keys arrive relative to this file: a sibling as `./x`, a cousin as `../app/x`. */
const named = (path: string): string =>
  path.replace(/^\.\//, 'design-system/').replace(/^\.\.\//, '')

const withoutCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** What each production file says, comments out: a comment explaining a token does not use it. */
const production = Object.entries(SOURCES)
  .map(([path, source]) => [named(path), source] as const)
  .filter(([path]) => !/\.test\.tsx?$/.test(path) && !/(^|\/)testing\//.test(path))
  .map(
    ([path, source]) =>
      [path, path.endsWith('.css') ? withoutCssComments(source) : withoutComments(source)] as const,
  )

const TOKENS_FILE = 'design-system/tokens.css'
const tokensCss = production.find(([path]) => path === TOKENS_FILE)?.[1] ?? ''

/** Custom properties declared in `css`, once each, whichever block declares them. */
const declaredIn = (css: string): readonly string[] => [
  ...new Set([...css.matchAll(/(?:^|[;{\s])(--[a-z0-9-]+)\s*:/g)].map(([, name = '']) => name)),
]

/** How many times `name` is referenced in `css`, not counting a declaration of it. */
const referencesTo = (name: string, css: string): number =>
  [...css.matchAll(new RegExp(`${name}(?![a-z0-9-])(?!\\s*:)`, 'g'))].length

const isUsed = (
  name: string,
  files: readonly (readonly [string, string])[] = production,
): boolean => files.some(([, css]) => referencesTo(name, css) > 0)

const DECLARED = declaredIn(tokensCss)

describe('every token tokens.css declares is used', () => {
  it('has something to read, rather than an empty glob', () => {
    expect(production.length).toBeGreaterThan(200)
    expect(DECLARED.length).toBeGreaterThan(60)
    expect(DECLARED).toContain('--focus-ring')
    expect(DECLARED).toContain('--accent-hue')
  })

  it('counts a reference in the shapes this tree has, and nothing else', () => {
    // The detector pointed at known positives and known negatives: without this, "every token
    // is used" below is as green for a broken pattern as for a tree that uses them.
    const used = (name: string, source: string): boolean =>
      isUsed(name, [['x.css', withoutCssComments(source)]])

    expect(used('--space-2', 'gap: var(--space-2);')).toBe(true)
    expect(used('--space-2', 'padding: 0 var(--space-3) var(--space-2);')).toBe(true)
    expect(used('--accent', '--focus-ring: 0 0 0 3px oklch(72% 0.17 var(--accent-hue));')).toBe(
      false,
    )
    expect(used('--accent-hue', '--focus-ring: 0 0 0 3px oklch(72% 0.17 var(--accent-hue));')).toBe(
      true,
    )
    expect(used('--space-2', '--space-2: 0.5rem;')).toBe(false)
    expect(used('--space-2', '  --space-2 : 0.5rem;')).toBe(false)
    expect(used('--space-2', '/* gap: var(--space-2); */')).toBe(false)
    expect(used('--space-2', 'gap: var(--space-20);')).toBe(false)
    expect(used('--space-2', 'gap: var(--space-2-5);')).toBe(false)
  })

  it('finds every declaration, including the ones a theme block repeats', () => {
    expect(
      declaredIn(':root { --a: 1; --b: 2 }\n[data-x] {\n  --a: 3;\n  --c-d: var(--a);\n}'),
    ).toEqual(['--a', '--b', '--c-d'])
  })

  it('has no token that nothing uses', () => {
    const unused = DECLARED.filter((name) => !isUsed(name))

    expect(
      unused,
      'tokens declared in tokens.css that no stylesheet, component or token refers to: delete each ' +
        'from tokens.css, and from the listing in docs/DESIGN-SYSTEM.md, which nothing checks',
    ).toEqual([])
  })
})
