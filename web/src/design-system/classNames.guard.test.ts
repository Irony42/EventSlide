import { describe, expect, it } from 'vitest'
import { withoutComments } from '../testing/withoutComments'

/**
 * Every class name in the app is joined by `cx` — the source, read.
 *
 * `classNames.ts` says why: a CSS Module class is `string | undefined`, and each of the
 * three ways of joining one without a helper had a fault of its own. They came back one
 * component at a time for as long as there was no rule, because each copy was three
 * lines and looked harmless. So the rule is read off every component, including the ones
 * written after this file.
 *
 * Read as text rather than imported, because what is
 * being asserted is how the code is spelled, and no behaviour distinguishes the spellings
 * until a stylesheet loses a class.
 */

const COMPONENTS = import.meta.glob<string>('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Glob keys arrive relative to this file: a sibling as `./x`, a cousin as `../app/x`. */
const named = (path: string): string =>
  path.replace(/^\.\//, 'design-system/').replace(/^\.\.\//, '')

/** Production components only: a test may spell a class however it likes. */
const production = Object.entries(COMPONENTS)
  .map(([path, source]) => [named(path), source] as const)
  .filter(([path]) => !path.endsWith('.test.tsx'))

/**
 * A join by a single space, whatever is in front of it: `[a, b].filter(Boolean).join(' ')`
 * on one line or as prettier breaks it over three, a `.filter((x) => x)` or a type-guard
 * filter, or no filter at all. A component has no other reason to join by a space than a
 * class list, and `cx` is the one place that does.
 */
const JOIN_BY_SPACE = /\.join\(\s*(['"`])\s\1\s*\)/g

/**
 * A template literal with a CSS Module lookup interpolated into it. The lookup is
 * `undefined` when the class is missing, and the literal prints that as text.
 */
const TEMPLATE_OF_STYLES = /`[^`]*\$\{\s*styles\[/g

/** A class made into a string with `?? ''` or `|| ''`, which leaves an empty `class` attribute. */
const COALESCED_STYLE = /styles\[[^\n]*?\]\s*(?:\?\?|\|\|)\s*(['"])\1/g

type Spelling = 'join-by-space' | 'template-literal' | 'coalesced'

/** The old spellings of "join class names" found in one source, one entry each. */
const oldSpellingsIn = (source: string): readonly Spelling[] => {
  const body = withoutComments(source)
  return [
    ...[...body.matchAll(JOIN_BY_SPACE)].map((): Spelling => 'join-by-space'),
    ...[...body.matchAll(TEMPLATE_OF_STYLES)].map((): Spelling => 'template-literal'),
    ...[...body.matchAll(COALESCED_STYLE)].map((): Spelling => 'coalesced'),
  ]
}

/**
 * The two places that still join with a space, and are not class names.
 *
 * `aria-describedby` is a space-separated list of element ids, built from a hint's id and
 * an error's id. The idiom is the same and the thing joined is not a class, so `cx` would
 * misname it. The count is exact, so a second join in either file — one for a `className`
 * — is not covered by this.
 */
const ID_LISTS: ReadonlyMap<string, number> = new Map([
  ['design-system/components/Field.tsx', 1],
  ['features/auth/components/TermsAgreement.tsx', 1],
])

describe('the old spellings of "join class names" are not accepted', () => {
  it('has something to read, rather than an empty glob', () => {
    expect(production.length).toBeGreaterThan(50)
    expect(production.map(([path]) => path)).toContain('design-system/components/Button.tsx')
  })

  it('catches each old spelling, in the shapes this tree has had and the ones it could gain', () => {
    // The detector pointed at known positives: without this, "no offenders" below is as
    // green for a broken regex as for a clean product. This is a guard on spellings, not a
    // proof: it stops the copies the tree has had and the obvious neighbours of them.
    const multiLine = [
      'const c = [styles.a, className]',
      '  .filter(Boolean)',
      "  .join(' ')",
    ].join('\n')

    expect(oldSpellingsIn("const c = [a, b].filter(Boolean).join(' ')")).toHaveLength(1)
    expect(oldSpellingsIn(multiLine)).toHaveLength(1)
    expect(oldSpellingsIn("const c = [a, b].filter((x) => x).join(' ')")).toHaveLength(1)
    expect(
      oldSpellingsIn("const c = [a, b].filter((x): x is string => x !== undefined).join(' ')"),
    ).toHaveLength(1)
    expect(oldSpellingsIn("const c = [a, b].join(' ')")).toHaveLength(1)
    expect(oldSpellingsIn('const c = [a, b].join(" ")')).toHaveLength(1)
    expect(oldSpellingsIn('const c = [a, b].join(` `)')).toHaveLength(1)
    expect(oldSpellingsIn("const c = `${styles['a']} ${styles[size]}`")).toHaveLength(1)
    expect(oldSpellingsIn("<Dialog className={styles['x'] ?? ''} />")).toHaveLength(1)
    expect(oldSpellingsIn('<Dialog className={styles["x"] ?? ""} />')).toHaveLength(1)
    expect(oldSpellingsIn("<Dialog className={styles['x'] || ''} />")).toHaveLength(1)
  })

  it('accepts cx, and a template literal that is only the index into the stylesheet', () => {
    expect(oldSpellingsIn("const c = cx(styles['a'], on && styles['b'], className)")).toEqual([])
    // `styles[`slot${slot}`]` is a lookup, not a join: the template is inside the brackets.
    expect(oldSpellingsIn("const c = cx(styles['tile'], styles[`slot${slot}`])")).toEqual([])
    expect(oldSpellingsIn("const ids = list.filter(Boolean).join(', ')")).toEqual([])
  })

  it('ignores a comment that names a spelling', () => {
    expect(oldSpellingsIn("// was [a].filter(Boolean).join(' ')\nconst c = cx(a)")).toEqual([])
    expect(oldSpellingsIn("/* a ?? '' on styles['a'] */ const c = cx(a)")).toEqual([])
  })

  it.each(production)('%s joins class names with cx and with nothing else', (path, source) => {
    // Exactly the allowed joins, and no other spelling. Exact rather than "at most": an
    // allowance for a join that was since deleted would excuse the next class join
    // somebody writes in that file.
    const allowed = Array.from({ length: ID_LISTS.get(path) ?? 0 }, (): Spelling => 'join-by-space')

    expect(oldSpellingsIn(source), `${path} joins class names without cx`).toEqual(allowed)
  })
})
