import { describe, expect, it } from 'vitest'

/**
 * The focus ring is drawn once, by `base.css` — the source, read.
 *
 * `:focus-visible { box-shadow: var(--focus-ring) }` is on every element that can take
 * focus. A module that repeats it on its own element adds nothing, and the repeat is a
 * liability: it is two specificity points stronger than the base rule, so when the base
 * rule is changed the repeat is where the old ring survives. Three had been written beside
 * `outline: none`, with an `outline-offset` that cannot apply to an outline that is none.
 *
 * What a module may do is draw the ring somewhere the base rule does not reach: on a tile
 * around a control that is itself transparent (`:focus-within`), on the card a keyboard
 * cursor sits on (`[data-active]`), or on a sibling or a pseudo-element of the focused
 * control. Those are other triggers and other elements, and the rule below names only the
 * one that is the base rule's own: a rule whose subject is the focused element, whatever
 * conditions it adds (`:not(…)`, `:is(:focus-visible)`).
 *
 * **One repeat is not a repeat**: where the same stylesheet gives that element a
 * `box-shadow` of its own (a card's elevation), that rule is later than the base rule at the
 * same specificity and hides the ring, so the repeat is what keeps it and stays. What this
 * does not guard is the other half of that: a focusable element whose own `box-shadow` hides
 * the ring and which has no repeat.
 *
 * Read as text rather than imported, for the reason `classNames.guard.test.ts` is: no
 * behaviour tells a repeated ring from the original.
 */

const STYLESHEETS = import.meta.glob<string>('../**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Glob keys arrive relative to this file: a sibling as `./x`, a cousin as `../app/x`. */
const named = (path: string): string =>
  path.replace(/^\.\//, 'design-system/').replace(/^\.\.\//, '')

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

const stylesheets = Object.entries(STYLESHEETS).map(
  ([path, source]) => [named(path), withoutComments(source)] as const,
)

const modules = stylesheets.filter(([path]) => path.endsWith('.module.css'))

const BASE = stylesheets.find(([path]) => path === 'design-system/base.css')?.[1] ?? ''

/** One declaration block: the selector list and what is inside the braces. Flat blocks only. */
const BLOCK = /([^{}]+)\{([^{}]*)\}/g

/**
 * Is the element that has focus the subject of `selector`? What follows the last
 * `:focus-visible` may add conditions to it (`:not([hidden])`, the `)` of an `:is()`) and may
 * not move off it: a combinator is a sibling or a descendant, `::` a pseudo-element.
 */
const focusedElementItself = (selector: string): boolean => {
  const at = selector.lastIndexOf(':focus-visible')
  if (at < 0) return false
  const rest = selector.slice(at + ':focus-visible'.length).replace(/\([^)]*\)/g, '')
  return !/[\s+>~]|::/.test(rest)
}

/**
 * The selectors, of every block in `css`, whose subject is the focused element and whose
 * block names the ring: the element's own focus, drawn again — unless the element has a
 * `box-shadow` of its own in the same stylesheet, which the repeat is there to beat.
 */
const repeatsOfTheRing = (css: string): readonly string[] => {
  const blocks = [...css.matchAll(BLOCK)].map(([, selectors = '', body = '']) => ({
    selectors: selectors.split(',').map((selector) => selector.trim()),
    body,
  }))
  const shadowed = new Set(
    blocks
      .filter(({ body }) => /(?:^|[;\s])box-shadow\s*:/.test(body))
      .flatMap(({ selectors }) => selectors),
  )
  return blocks.flatMap(({ selectors, body }) =>
    /var\(\s*--focus-ring\s*\)/.test(body)
      ? selectors.filter(
          (selector) =>
            focusedElementItself(selector) &&
            !shadowed.has(selector.slice(0, selector.indexOf(':focus-visible'))),
        )
      : [],
  )
}

describe('the focus ring is drawn once', () => {
  it('has stylesheets to read, rather than an empty glob', () => {
    expect(modules.length).toBeGreaterThan(50)
    expect(BASE.length).toBeGreaterThan(0)
  })

  it('is drawn on every :focus-visible by base.css', () => {
    expect(repeatsOfTheRing(BASE)).toEqual([':focus-visible'])
    expect(BASE).toMatch(/:focus-visible\s*\{[^}]*box-shadow:\s*var\(--focus-ring\)/)
  })

  it('finds a repeat in the shapes this tree has had, and nothing else', () => {
    // The detector pointed at known positives and known negatives: without this, "no module
    // repeats it" below is as green for a broken pattern as for a clean tree.
    const found = (css: string): number => repeatsOfTheRing(withoutComments(css)).length

    expect(
      found('.item:focus-visible {\n  outline: none;\n  box-shadow: var(--focus-ring);\n}'),
    ).toBe(1)
    expect(found('.row:focus-visible { box-shadow: var( --focus-ring ); }')).toBe(1)
    expect(found('.a:focus-visible,\n.b:focus-visible { box-shadow: var(--focus-ring); }')).toBe(2)
    // The same element, with conditions added.
    expect(found('.t:focus-visible:not([hidden]) { box-shadow: var(--focus-ring); }')).toBe(1)
    expect(found('.t:is(:focus-visible) { box-shadow: var(--focus-ring); }')).toBe(1)
    expect(found('.t:where(:focus-visible, :hover) { box-shadow: var(--focus-ring); }')).toBe(1)
    expect(found('.t { & :focus-visible { box-shadow: var(--focus-ring); } }')).toBe(1)
    // A sibling or a pseudo-element of the focused control is another element.
    expect(found('.a:focus-visible + .tile { box-shadow: var(--focus-ring); }')).toBe(0)
    expect(found('.a:focus-visible ~ .tile { box-shadow: var(--focus-ring); }')).toBe(0)
    expect(found('.a:focus-visible::after { box-shadow: var(--focus-ring); }')).toBe(0)
    // An element with a shadow of its own needs the repeat: its own rule would hide the ring.
    expect(
      found(
        '.card { box-shadow: var(--shadow-md); }\n.card:focus-visible { box-shadow: var(--focus-ring); }',
      ),
    ).toBe(0)
    expect(
      found('.card { padding: 0; }\n.card:focus-visible { box-shadow: var(--focus-ring); }'),
    ).toBe(1)
    // Other triggers, other elements, and a rule that is about something else.
    expect(found('.action:focus-within { box-shadow: var(--focus-ring); }')).toBe(0)
    expect(found(".card[data-active='true'] { box-shadow: var(--focus-ring); }")).toBe(0)
    expect(found('.input:focus-visible { border-color: var(--accent); }')).toBe(0)
    expect(found('.item:focus-visible { box-shadow: var(--shadow-md); }')).toBe(0)
    expect(found('/* .item:focus-visible { box-shadow: var(--focus-ring); } */')).toBe(0)
    expect(
      found('@media (min-width: 1px) { .x:focus-visible { box-shadow: var(--focus-ring); } }'),
    ).toBe(1)
  })

  it('is not drawn again by a module on its own element', () => {
    const repeats = modules.flatMap(([path, css]) =>
      repeatsOfTheRing(css).map((selector) => `${path}: ${selector}`),
    )

    expect(
      repeats,
      'rules that repeat base.css’s ring on the element’s own :focus-visible: delete each',
    ).toEqual([])
  })
})
