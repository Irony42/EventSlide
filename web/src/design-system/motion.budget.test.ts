import { describe, expect, it } from 'vitest'

/**
 * The motion budget, made mechanical — roadmap 11.2.
 *
 * docs/DESIGN-SYSTEM.md §7 has said since 2.0 that motion is `opacity` and `transform`,
 * never a property that forces layout, "because the wall runs for eight hours on whatever
 * hardware the venue owns". It has been a paragraph, and a paragraph is checked by whoever
 * happens to review the diff — which is the wrong person, because the change that breaks it
 * is one line of plausible CSS in a feature folder nobody is reading beside the wall.
 *
 * So it is checked here, the same way the glass material is (`glass.material.test.ts`) and
 * the same way the layer boundaries are (CLAUDE.md §2): read off every stylesheet the app
 * ships, including the ones written after this file.
 *
 * Two rules, and they are not the same rule:
 *
 * - **Nothing animates a property that costs a layout.** This is the one that protects the
 *   projector, and it holds everywhere without exception.
 * - **Every animation states what it does under `prefers-reduced-motion`.** Not "is
 *   allowed" — *states*, out of a closed set of answers, because the two answers this
 *   product uses are genuinely different and the wrong one is silently broken.
 */

const STYLESHEETS = import.meta.glob<string>('../**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const named = (path: string): string =>
  path.replace(/^\.\//, 'design-system/').replace(/^\.\.\//, '')

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

const entries = Object.entries(STYLESHEETS).map(
  ([path, source]) => [named(path), withoutComments(source)] as const,
)

/**
 * Properties whose animation forces the browser to lay the page out again, every frame.
 *
 * `background-position` is in §7's list and is a paint rather than a layout; it is kept
 * here because on the wall a repainted full-screen gradient costs what a relayout costs,
 * and because §7 named it. The logical spellings are listed beside the physical ones: this
 * repository writes `inline-size` and `inset-block-end` by preference, so a rule that only
 * knew `width` and `bottom` would be a rule this codebase routes around by habit.
 */
const LAYOUT_PROPERTIES = [
  'width',
  'height',
  'inline-size',
  'block-size',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'inset-block',
  'inset-inline',
  'inset-block-start',
  'inset-block-end',
  'inset-inline-start',
  'inset-inline-end',
  'margin',
  'padding',
  'border-width',
  'font-size',
  'line-height',
  'gap',
  'flex',
  'grid-template-columns',
  'background-position',
] as const

/** `transition: <property> …`, with the shorthand's comma-separated list unpicked. */
const transitionedProperties = (css: string): readonly string[] =>
  [...css.matchAll(/(?:^|[;{\s])transition(?:-property)?\s*:\s*([^;}]+)/g)]
    .flatMap((match) => (match[1] ?? '').split(','))
    .flatMap((part) => {
      const first = part.trim().split(/\s+/)[0]
      return first === undefined || first === '' ? [] : [first]
    })

/** Every property named inside a `@keyframes` block, which is where an animation moves. */
const keyframedProperties = (css: string): readonly string[] =>
  [...css.matchAll(/@keyframes[^{]*\{([\s\S]*?)\n\}/g)]
    .flatMap((match) => [...(match[1] ?? '').matchAll(/(?:^|[;{\s])([a-z-]+)\s*:/g)])
    .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))

describe('motion never asks the browser to lay the page out again', () => {
  it('sweeps the stylesheets the app actually ships', () => {
    // Without this, every assertion below would pass over an empty list the day the glob
    // stopped matching, and the budget would be decoration.
    expect(entries.length).toBeGreaterThan(30)
    expect(entries.map(([path]) => path)).toContain(
      'features/wall/components/SlideLayer.module.css',
    )
  })

  it('transitions no property that forces a layout', () => {
    const offenders = entries.flatMap(([path, css]) =>
      transitionedProperties(css)
        .filter((property) => LAYOUT_PROPERTIES.includes(property as never))
        .map((property) => `${path}: transition ${property}`),
    )

    expect(offenders).toEqual([])
  })

  it('keyframes no property that forces a layout', () => {
    // The half a transition sweep misses, and the more dangerous one: a keyframe moves its
    // property on every frame of the animation by definition, and the wall is nothing but
    // keyframes.
    const offenders = entries.flatMap(([path, css]) =>
      keyframedProperties(css)
        .filter((property) => LAYOUT_PROPERTIES.includes(property as never))
        .map((property) => `${path}: @keyframes ${property}`),
    )

    expect(offenders).toEqual([])
  })

  it('finds the properties that are there, rather than matching nothing at all', () => {
    // The regexes, pointed at known content. A sweep that parsed nothing would report a
    // clean product for ever.
    const slide = entries.find(([path]) => path.endsWith('SlideLayer.module.css'))?.[1] ?? ''

    expect(transitionedProperties(slide)).toContain('opacity')
    expect(keyframedProperties(slide)).toContain('transform')
  })
})

/**
 * What every animation in this product answers `prefers-reduced-motion` with.
 *
 * A list, so that adding one is a deliberate edit rather than a silent inheritance of
 * whichever answer happens to be nearest — and the answers are not interchangeable:
 *
 * - `no-preference` — the rule is declared *inside* `@media (prefers-reduced-motion:
 *   no-preference)`, so under the preference it does not exist. The right answer for
 *   anything that appears: the element is simply there.
 * - `declined-in-javascript` — the component reads the preference and does not render the
 *   animation at all (`usePrefersReducedMotion`). Required wherever a keyframe's end frame
 *   is not the resting state, because `base.css` collapses the *duration* and leaves
 *   `animation-fill-mode: both` holding the final frame: a Ken Burns collapsed that way
 *   does not stop, it snaps to `scale(1.08)` and stays there, on a projector.
 * - `reduce-branch` — the file declares its own `@media (prefers-reduced-motion: reduce)`
 *   replacement. Only the `Spinner` needs this: an indeterminate wait cannot simply stop
 *   moving, or a guest on bad Wi-Fi is looking at a frozen screen, so it swaps a rotation
 *   for an opacity pulse.
 */
const REDUCED_MOTION_ANSWERS: Readonly<Record<string, string>> = {
  'design-system/components/Dialog.module.css': 'no-preference',
  'design-system/components/Spinner.module.css': 'reduce-branch',
  'design-system/components/Toast.module.css': 'no-preference',
  'features/guest-upload/components/UploadQueue.module.css': 'no-preference',
  'features/moderation/components/ModerationGrid.module.css': 'no-preference',
  'features/wall/WallPage.module.css': 'declined-in-javascript',
  'features/wall/components/ReactionBurst.module.css': 'declined-in-javascript',
  'features/wall/components/SlideLayer.module.css': 'declined-in-javascript',
  'features/wall/components/WallLayouts.module.css': 'declined-in-javascript',
}

describe('every animation states what it does under prefers-reduced-motion', () => {
  const animating = entries
    .filter(([, css]) => /(?:^|[;{\s])animation\s*:/.test(css))
    .map(([path]) => path)
    .sort()

  it('is the list above, and nothing has been added without answering', () => {
    // The assertion that makes this file a guard rather than a record. A new animation
    // anywhere fails here until somebody writes down which of the three answers it gives —
    // which is the moment to notice that the answer is wrong.
    expect(animating).toEqual(Object.keys(REDUCED_MOTION_ANSWERS).sort())
  })

  it.each(
    Object.entries(REDUCED_MOTION_ANSWERS).filter(([, answer]) => answer === 'no-preference'),
  )('%s declares its animation inside the no-preference query', (path) => {
    const css = entries.find(([name]) => name === path)?.[1] ?? ''

    // Inside the query, so the rule does not exist under the preference — rather than
    // existing at a collapsed duration with `both` holding a frame nobody chose.
    for (const rule of css.matchAll(/(?:^|[;{\s])animation\s*:/g)) {
      const before = css.slice(0, rule.index)
      const opened = before.lastIndexOf('@media (prefers-reduced-motion: no-preference)')
      expect(opened, `${path} animates outside the query`).toBeGreaterThanOrEqual(0)
      expect(before.slice(opened)).not.toContain('}\n}')
    }
  })

  it.each(
    Object.entries(REDUCED_MOTION_ANSWERS).filter(
      ([, answer]) => answer === 'declined-in-javascript',
    ),
  )('%s belongs to the wall, which declines in the component', (path) => {
    // Asserted as a property of the path rather than of the CSS, because the declining is
    // in the `.tsx` beside it. What this pins is that the answer cannot be claimed by a
    // stylesheet that has no component reading the preference — every file here is one the
    // wall renders, and `usePrefersReducedMotion` is the wall's hook.
    expect(path.startsWith('features/wall/')).toBe(true)
  })
})
