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
 * Four rules, and they are not the same rule:
 *
 * - **Nothing animates a property that costs a layout.** This is the one that protects the
 *   projector, and it holds everywhere without exception.
 * - **Nothing animates a paint property on the wall.** The tier above it is legal on a
 *   laptop and on a phone; a full-screen repaint on a projector is not.
 * - **`will-change` is declared nowhere outside the wall.** It buys a compositing layer
 *   for the lifetime of an element rather than the length of an animation.
 * - **Every animation states what it does under `prefers-reduced-motion`.** Not "is
 *   allowed" — *states*, out of a closed set of answers, because the two answers this
 *   product uses are genuinely different and the wrong one is silently broken.
 *
 * The middle two were §7 prose with nothing measuring them until this file's second pass.
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
 * The components beside the stylesheets, because one of the four answers is about them.
 *
 * `declined-in-javascript` is a claim that a `.tsx` reads the preference and does not render
 * the animation. That claim cannot be checked in CSS, and the version of this file that
 * tried asserted the stylesheet's own path instead — which restated the table rather than
 * testing it. Reading the component is the only way the answer means anything.
 */
const COMPONENTS = import.meta.glob<string>('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const components = new Map(
  Object.entries(COMPONENTS).map(([path, source]) => [named(path), source]),
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
  /**
   * `transition: all`, which is not a layout property but is every layout property.
   *
   * It belongs in this list rather than in a check of its own because it is a superset of
   * the list: the shorthand animates whatever happens to change, so one plausible line in a
   * feature folder buys `width`, `margin` and `background-color` at once while naming none
   * of them. It is also the single most likely line a contributor writes, and the rule this
   * file states is that the layout tier holds "everywhere without exception".
   */
  'all',
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
 * The other two tiers, which the table in §7 states and nothing measured.
 *
 * The three-tier budget landed with only its layout row mechanical. That is the shape of
 * defect a mutation audit already found in this repository more than once: a rule whose
 * only enforcement is the paragraph that states it, green for as long as whoever reads the
 * diff happens to remember it. Both rules below hold today — so these fail on the change
 * that breaks them, which is the only moment they are worth anything.
 */

/** Wall stylesheets: the surface that repaints a full screen for eight hours. */
const isWall = (path: string): boolean => path.startsWith('features/wall/')

/**
 * §7's paint tier: legal on a laptop or a phone at `--duration-fast`/`--duration-base`,
 * and never on the wall. A repainted full-screen gradient costs the projector what a
 * relayout costs, which is the reason the tier is split from the compositor one at all.
 */
const PAINT_PROPERTIES = [
  'color',
  'background-color',
  'background',
  // The one a `background-position` entry above does not cover: swapping the image itself
  // is a full-screen decode, which on a projector is the most expensive frame there is.
  'background-image',
  'border-color',
  'box-shadow',
]

describe('the paint tier stops at the wall', () => {
  it('has wall stylesheets to look at', () => {
    // Without this the two assertions below are green over an empty list the day the
    // feature folder is renamed.
    expect(entries.filter(([path]) => isWall(path)).length).toBeGreaterThan(3)
  })

  it('transitions no paint property on the wall', () => {
    const offenders = entries
      .filter(([path]) => isWall(path))
      .flatMap(([path, css]) =>
        transitionedProperties(css)
          .filter((property) => PAINT_PROPERTIES.includes(property))
          .map((property) => `${path}: transition ${property}`),
      )

    expect(offenders).toEqual([])
  })

  it('keyframes no paint property on the wall', () => {
    const offenders = entries
      .filter(([path]) => isWall(path))
      .flatMap(([path, css]) =>
        keyframedProperties(css)
          .filter((property) => PAINT_PROPERTIES.includes(property))
          .map((property) => `${path}: @keyframes ${property}`),
      )

    expect(offenders).toEqual([])
  })
})

/** Every `will-change` declaration a stylesheet makes, as the properties it names. */
const willChangedProperties = (css: string): readonly string[] =>
  [...css.matchAll(/(?:^|[;{\s])will-change\s*:\s*([^;}]+)/g)]
    .flatMap((match) => (match[1] ?? '').split(','))
    .map((part) => part.trim())
    .filter((part) => part !== '')

describe('will-change is spent on the wall and nowhere else', () => {
  it('finds the wall spending it, rather than matching nothing', () => {
    // §7 permits it on the wall's own layers, so the wall is where it must be found. A
    // regex that parsed nothing would make the sweep below a permanent pass.
    const spenders = entries
      .filter(([, css]) => willChangedProperties(css).length > 0)
      .map(([path]) => path)

    expect(spenders).toContain('features/wall/components/SlideLayer.module.css')
    expect(
      willChangedProperties(entries.find(([p]) => p.endsWith('SlideLayer.module.css'))?.[1] ?? ''),
    ).toContain('opacity')
  })

  it('is declared in no stylesheet outside the wall', () => {
    // It pins a compositing layer for the lifetime of an element, not for the length of an
    // animation — which on a phone mid-encode is memory taken from the thing the guest is
    // actually waiting for. The arrival animation on the moderation queue declines it in a
    // comment; this is what makes the next one decline it too.
    const offenders = entries
      .filter(([path]) => !isWall(path))
      .flatMap(([path, css]) => willChangedProperties(css).map((value) => `${path}: ${value}`))

    expect(offenders).toEqual([])
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
 * - `survives-collapsed` — the animation is left to `base.css`, and that is safe because
 *   its final frame *is* the resting state, so the collapsed duration lands exactly where
 *   the element belongs. The fourth answer exists because the first three did not describe
 *   the wall's offline notice and it was filed under `declined-in-javascript`, which was
 *   simply untrue: `WallPage.tsx` never reads the preference. What that rule actually needs
 *   is its `animation-delay` — the one part of an animation reduced motion does **not**
 *   collapse — because a venue's network drops for a second several times an evening and a
 *   notice that waits is the difference between a wall that looks broken and one that is
 *   working. Moving it into `no-preference` would have announced every blip to the room.
 *   The bucket is mechanically checked below, which is what stops it becoming a shrug.
 */
/**
 * What starts an animation, in both spellings CSS allows.
 *
 * The longhand is not a nicety: `animation\s*:` does not match `animation-name:`, because
 * what follows `animation` there is a hyphen. A stylesheet written with the longhands was
 * therefore invisible to the sweep below — never added to `animating`, so the equality
 * against the table below still passed and the animation was never asked what it does under
 * `prefers-reduced-motion`. `transitionedProperties` already handles `transition-property`
 * for exactly this reason, and the asymmetry was the bug. `animation-name` is the only
 * longhand that can start one; `animation-duration` on its own animates nothing.
 */
const ANIMATION_DECLARATION = /(?:^|[;{\s])animation(?:-name)?\s*:/

const REDUCED_MOTION_ANSWERS: Readonly<Record<string, string>> = {
  'design-system/components/Dialog.module.css': 'no-preference',
  'design-system/components/Spinner.module.css': 'reduce-branch',
  'design-system/components/Toast.module.css': 'no-preference',
  'features/guest-upload/components/UploadQueue.module.css': 'no-preference',
  'features/moderation/components/ModerationGrid.module.css': 'no-preference',
  'features/wall/WallPage.module.css': 'survives-collapsed',
  'features/wall/components/ReactionBurst.module.css': 'declined-in-javascript',
  'features/wall/components/SlideLayer.module.css': 'declined-in-javascript',
  'features/wall/components/WallLayouts.module.css': 'declined-in-javascript',
}

describe('every animation states what it does under prefers-reduced-motion', () => {
  const animating = entries
    .filter(([, css]) => ANIMATION_DECLARATION.test(css))
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
    for (const rule of css.matchAll(new RegExp(ANIMATION_DECLARATION, 'g'))) {
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
  )('%s is owned by a component that actually reads the preference', (path) => {
    // This replaced `expect(path.startsWith('features/wall/')).toBe(true)`, which could not
    // fail for any entry anybody would write: the path and the answer sit next to each other
    // in the table above, so the assertion only restated the row it was reading. It passed
    // for `WallPage.module.css`, whose component does not read the preference at all.
    //
    // The claim the label makes is about the `.tsx` beside the stylesheet, so that is what
    // is read. `usePrefersReducedMotion` is the hook; a component that does not import it
    // cannot be declining anything.
    const owner = path.replace(/\.module\.css$/, '.tsx')
    const source = components.get(owner)

    expect(source, `${path} claims a component at ${owner}, which does not exist`).toBeDefined()
    expect(source ?? '', `${owner} does not read usePrefersReducedMotion`).toContain(
      'usePrefersReducedMotion',
    )
  })

  it.each(
    Object.entries(REDUCED_MOTION_ANSWERS).filter(([, answer]) => answer === 'survives-collapsed'),
  )('%s ends every animation at the resting state', (path) => {
    // The whole of what makes this answer safe, and therefore the whole of what has to be
    // checked. `base.css` collapses the duration to 1ms and `both` holds the final frame, so
    // an animation left to it lands on its own last keyframe instantly. That is harmless
    // exactly when the last keyframe is where the element belongs anyway — and a silent
    // disaster when it is not, which is the Ken Burns case: `scale(1.08)`, held, on a
    // projector, for the rest of the evening.
    const css = entries.find(([name]) => name === path)?.[1] ?? ''
    const blocks = [...css.matchAll(/@keyframes[^{]*\{([\s\S]*?)\n\}/g)]

    expect(blocks.length, `${path} declares no keyframes to check`).toBeGreaterThan(0)

    for (const block of blocks) {
      const body = block[1] ?? ''
      const at = Math.max(body.lastIndexOf('to {'), body.lastIndexOf('100% {'))
      expect(at, `${path} has a keyframe with no final frame`).toBeGreaterThanOrEqual(0)

      const final = body.slice(at)
      // Fully opaque, or it does not touch opacity at all.
      for (const match of final.matchAll(/opacity\s*:\s*([^;}]+)/g)) {
        const value = (match[1] ?? '').trim()
        expect(value, `${path} ends at opacity ${value}`).toBe('1')
      }
      // And it does not come to rest displaced. A transform at the end is the shape of the
      // failure above, so this bucket refuses one outright rather than trying to decide
      // which transforms happen to be identities.
      expect(/transform\s*:/.test(final), `${path} ends holding a transform`).toBe(false)
    }
  })
})

/**
 * What every wall animation does when the machine runs out — roadmap 11.3.
 *
 * The same shape of guard as the `prefers-reduced-motion` table above, for the same reason,
 * and it exists because the rule it enforces shipped broken. The budget's two wall rungs
 * were declared only in `SlideLayer.module.css` — the spotlight, and the split's panes — so
 * on the mosaic, the polaroid pile, the filmstrip and the collage a machine that had run out
 * gave up nothing at all while the ladder reported that it had. The wall went on paying for
 * every animation on screen, on the layout `WallPage.tsx`'s cycle puts one keypress away
 * from a host during a cocktail hour.
 *
 * That is this repository's recurring failure exactly: a rule true in the file somebody was
 * looking at and false in the four beside it. So what is checked is not "the spotlight
 * degrades" but **every wall stylesheet that animates answers the budget**, which is what
 * fails the day a seventh layout is added.
 *
 * Two answers, and which one a file gets is not a label:
 *
 * - `still` — the file has motion that runs for the length of a slide, so it is switched
 *   off one rung *before* the bottom as well as at it. Ken Burns and the filmstrip's drift
 *   are the two, and both are recognisable without being told: their duration is a custom
 *   property the slideshow hands down, which is checked below rather than trusted.
 * - `cut` — only motion at a slide change, or chrome. Switched off at the bottom rung.
 *
 * What is **not** swept, said plainly: *how* each rule switches its animation off. `none`
 * and a collapsed duration are both correct and each is wrong in the other's place — the
 * polaroid keeps its tilt under `none` only because `.print` declares that tilt for itself,
 * and the offline notice needs a collapsed duration because `none` would take its
 * `animation-delay` with it and announce every two-second network blip to the room. Those
 * are argued beside each rule and reviewed, not measured here.
 */
const WALL_BUDGET_ANSWERS: Readonly<Record<string, 'still' | 'cut'>> = {
  'features/wall/WallPage.module.css': 'cut',
  'features/wall/components/ReactionBurst.module.css': 'cut',
  'features/wall/components/SlideLayer.module.css': 'still',
  'features/wall/components/WallLayouts.module.css': 'still',
}

/** A rung, as a stylesheet declares it: an ancestor attribute the wall's root carries. */
const rungFor = (css: string, rung: 'still' | 'cut'): boolean =>
  new RegExp(`\\[data-wall-budget='${rung}'\\]`).test(css)

/**
 * Durations the slideshow hands down at runtime.
 *
 * An animation timed by one of these runs for as long as its slide is on screen, which is
 * what makes it the wall's continuous cost rather than a moment at a change. Derived from
 * the stylesheet so that filing one of them under the cheaper answer fails.
 */
const SLIDESHOW_TIMED = ['--wall-kenburns-duration', '--wall-drift-duration']

describe('every wall animation says what it gives up when the machine runs out', () => {
  const animating = entries
    .filter(([path]) => isWall(path))
    .filter(([, css]) => ANIMATION_DECLARATION.test(css) || /(?:^|[;{\s])transition\s*:/.test(css))
    .map(([path]) => path)
    .sort()

  it('is the list above, and a new layout cannot be added without answering', () => {
    // The assertion that makes this a guard rather than a record, and the one that would
    // have caught the four layouts that shipped with no rungs at all.
    expect(animating).toEqual(Object.keys(WALL_BUDGET_ANSWERS).sort())
  })

  it.each(Object.keys(WALL_BUDGET_ANSWERS))('%s gives something up at the bottom rung', (path) => {
    const css = entries.find(([name]) => name === path)?.[1] ?? ''

    expect(css, `${path} declares no [data-wall-budget='cut'] rule`).toBeTruthy()
    expect(rungFor(css, 'cut'), `${path} animates and never answers the bottom rung`).toBe(true)
  })

  it.each(
    Object.entries(WALL_BUDGET_ANSWERS)
      .filter(([, answer]) => answer === 'still')
      .map(([path]) => path),
  )('%s gives its slide-length motion up one rung earlier', (path) => {
    const css = entries.find(([name]) => name === path)?.[1] ?? ''

    expect(rungFor(css, 'still'), `${path} claims slide-length motion and never sheds it`).toBe(
      true,
    )
  })

  it('files timed from the slideshow are exactly the files that answer at the earlier rung', () => {
    // The half of the table that is derived rather than declared. An animation whose
    // duration is the slide's own runs for the whole slide by construction, so filing it
    // under `cut` would leave the wall paying for continuous motion at the rung whose entire
    // purpose is to stop paying for it.
    const timed = entries
      .filter(([path]) => isWall(path))
      .filter(([, css]) => SLIDESHOW_TIMED.some((property) => css.includes(property)))
      .map(([path]) => path)
      .sort()

    const answered = Object.entries(WALL_BUDGET_ANSWERS)
      .filter(([, answer]) => answer === 'still')
      .map(([path]) => path)
      .sort()

    expect(timed).toEqual(answered)
  })

  it('finds the properties it is sweeping for, rather than matching nothing', () => {
    // Every assertion above is a regex over a glob, and both can silently stop matching.
    expect(animating.length).toBeGreaterThan(3)
    expect(rungFor(`[data-wall-budget='cut'] .thing { animation: none; }`, 'cut')).toBe(true)
    expect(rungFor(`.thing { animation: none; }`, 'cut')).toBe(false)
  })
})
