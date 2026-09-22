import { describe, expect, it } from 'vitest'
import TOKENS from './tokens.css?raw'
import MATERIAL from './glass.module.css?raw'

/**
 * Glass is a material, and this is the test that keeps it one — roadmap 11.1.
 *
 * The roadmap's argument for tokens over per-component CSS is not tidiness: "a glass pane
 * whose blur differs by four pixels from the one beside it reads as a mistake even to
 * someone who cannot say why". That failure arrives one harmless-looking commit at a
 * time, and it is invisible in review, because each of those commits is three lines of
 * plausible CSS in a file nobody is reading beside the other nineteen.
 *
 * So the rule is mechanical, exactly as the architecture boundaries are (CLAUDE.md §2):
 *
 * - `tokens.css` is the only file that **declares** `--glass-*`.
 * - `glass.module.css` is the only file that **reads** it.
 * - Everything else asks for the material by name, with `composes`.
 *
 * Those three together are what makes "the performance budget can be enforced in one
 * place" true rather than aspirational: there is one `backdrop-filter` declaration in the
 * source, and one set of tokens feeding it. **In the source** — CSS Modules copies a
 * composed class into every chunk that uses it, so the built artifact carries `.sheet`
 * once per chunk. That is a bundler detail and not a second definition; what these
 * assertions protect is the thing a person edits.
 *
 * Read off the real stylesheets rather than a list somebody maintains: a file added
 * tomorrow is in this sweep the moment it exists.
 */

/** Every stylesheet the web app ships, by path, as source. */
const STYLESHEETS = import.meta.glob<string>('../**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/**
 * Glob keys are relative to this file, so a sibling arrives as `./tokens.css` and a
 * cousin as `../features/…`. Normalised to one shape rooted at `web/src`, so a failure
 * names a path a reader can open.
 */
const named = (path: string): string =>
  path.replace(/^\.\//, 'design-system/').replace(/^\.\.\//, '')

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

const entries = Object.entries(STYLESHEETS).map(
  ([path, source]) => [named(path), withoutComments(source)] as const,
)

/** The material's own source, minus the comments that describe the rules it obeys. */
const MATERIAL_RULES = withoutComments(MATERIAL)

const MATERIAL_FILE = 'design-system/glass.module.css'
const TOKENS_FILE = 'design-system/tokens.css'

/**
 * The surfaces wearing the material, listed so that adding one is a deliberate edit.
 *
 * "A material nobody can see is not reviewable; a material applied everywhere is not
 * reviewable either." Three sheets, and they are the same sheet three times: **a sticky pane
 * with the reader's own content moving underneath it.** The guest's composer sits over the
 * photographs they just sent; the host's toolbar sits over the queue scrolling under it; the
 * shared gallery's download bar (roadmap §4.1) sits over the album scrolling under it.
 * That is the whole rule, and it is what makes the material visible — a blur with nothing
 * moving behind it is an expensive way to draw a panel.
 *
 * `Dialog` was the obvious third and was measured out: its `::backdrop` is a 55% scrim, so
 * about 2% of the page reaches a pane at the tint floor, and the panel animates on open —
 * which would have been a backdrop re-filtered every frame for 240 ms, on a phone,
 * possibly mid-upload. Both halves of that are now assertions rather than judgement:
 * `GLASS_SURFACES` below, and `declares no motion of its own` further down.
 *
 * The room is absent on purpose and that is the budget, not an oversight — see
 * `glass.ts`, and `AppShell` for where it is applied.
 */
const GLASS_SURFACES = [
  'features/gallery/GalleryPage.module.css',
  'features/guest-upload/GuestUploadPage.module.css',
  'features/moderation/components/ModerationToolbar.module.css',
] as const

/** What the material declares, and therefore what a consumer may not. */
const MATERIAL_PROPERTIES = ['background', 'border', 'box-shadow', 'backdrop-filter'] as const

/**
 * Asking for the material by name. Either quote, because CSS accepts both and a pattern
 * that matched only one would let a new surface in unseen — which is exactly the half of
 * "and no others" that is worth having.
 */
const WEARS_THE_MATERIAL = /composes:\s*sheet\s+from\s+['"][^'"]*glass\.module\.css['"]/

describe('the glass material is defined once', () => {
  it('sweeps the stylesheets the app actually ships', () => {
    // If the glob stopped matching, every assertion below would pass over an empty list
    // and this file would be decoration.
    expect(entries.length).toBeGreaterThan(30)
    expect(entries.map(([path]) => path)).toContain(MATERIAL_FILE)
  })

  it('declares --glass-* in tokens.css and nowhere else', () => {
    const declaring = entries
      .filter(([path, css]) => path !== TOKENS_FILE && /--glass-[a-z-]+\s*:/.test(css))
      .map(([path]) => path)

    expect(declaring).toEqual([])
  })

  it('reads the material tokens in glass.module.css and nowhere else', () => {
    // The rule the whole point rests on. A component that reaches for `var(--glass-blur)`
    // is a component that owns a blur radius, which is what a material exists to stop.
    //
    // `tokens.css` is excused because a tier there rewrites one glass token in terms of
    // another (`--glass-tint: var(--glass-opaque)`), which is the declaration site
    // referring to itself rather than a consumer reaching in.
    const reading = entries
      .filter(
        ([path, css]) =>
          path !== MATERIAL_FILE && path !== TOKENS_FILE && css.includes('var(--glass-'),
      )
      .map(([path]) => path)

    expect(reading).toEqual([])
  })

  it('gives an element a backdrop-filter in glass.module.css and nowhere else', () => {
    // One declaration in the whole product, which is what lets the budget be enforced in
    // one place. `tokens.css` names the property too, but only inside the `@supports`
    // query that asks whether the browser has it — asserted on its own below.
    const blurring = entries
      .filter(
        ([path, css]) =>
          path !== MATERIAL_FILE && path !== TOKENS_FILE && /backdrop-filter\s*:/.test(css),
      )
      .map(([path]) => path)

    expect(blurring).toEqual([])
    expect(withoutComments(TOKENS).replace(/@supports[^{]*/g, '')).not.toMatch(
      /backdrop-filter\s*:/,
    )
  })

  it('is worn by the surfaces that were argued for, and no others', () => {
    const wearing = entries
      .filter(([, css]) => WEARS_THE_MATERIAL.test(css))
      .map(([path]) => path)
      .sort()

    expect(wearing).toEqual([...GLASS_SURFACES].sort())
  })
})

/**
 * What a consumer may not do to the thing it is wearing.
 *
 * Both rules below were written because the first draft of this change broke them and the
 * sweep above could not see it: it greps `glass.module.css`, and the danger is never in
 * `glass.module.css`. A material is only defined once if the rules wearing it leave it
 * alone.
 */
describe('a surface wearing the material leaves it alone', () => {
  /** The class names that ask for the material, per file. */
  const wearerClasses = (css: string): readonly string[] =>
    [...css.matchAll(/\.([A-Za-z][\w-]*)\s*\{[^{}]*composes:\s*sheet\s+from/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    )

  /**
   * The body of **every** rule whose selector names that class — not only the one carrying
   * `composes`.
   *
   * That distinction is the whole reason this block exists. The Dialog declared its
   * animation in a second rule, inside `@media (prefers-reduced-motion: no-preference)`,
   * several lines below the one wearing the material; a check that looked only at the
   * composing rule would have reported the file clean.
   */
  const bodiesTargeting = (css: string, name: string): readonly string[] =>
    [...css.matchAll(new RegExp(`[^{}]*\\.${name}\\b[^{}]*\\{([^{}]*)\\}`, 'g'))].flatMap(
      (match) => (match[1] === undefined ? [] : [match[1]]),
    )

  const wearers = entries.flatMap(([path, css]) =>
    wearerClasses(css).flatMap((name) =>
      bodiesTargeting(css, name).map((body) => [path, body] as const),
    ),
  )

  it('finds rules to check, rather than passing over none of them', () => {
    expect(wearers.length).toBeGreaterThanOrEqual(GLASS_SURFACES.length)
  })

  it.each(MATERIAL_PROPERTIES)('redeclares no %s of its own', (property) => {
    // Not a style preference. CSS Modules emits the material's rule wherever the bundler
    // puts it, and in a code-split chunk `.sheet` can land *after* the consumer's own rule
    // — so a consumer that sets `background` might win on one page and lose on another.
    // Leaving the four alone is what makes the outcome independent of emission order.
    const offenders = wearers
      .filter(([, body]) => new RegExp(`(^|[;\\s])${property}\\s*:`).test(body))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })

  it('declares no motion of its own, because the backdrop moves with it', () => {
    // The rule the Dialog failed, which is why it is no longer in the list above.
    // `animation: enter …` there moved `opacity` and `transform`, which DESIGN-SYSTEM.md
    // §7 permits everywhere else — and on a blurred element that is a backdrop re-filtered
    // every frame for the length of the animation, on a phone, possibly mid-upload. A
    // surface that has to animate animates a wrapper and wears the material underneath.
    const moving = wearers
      .filter(([, body]) => /(^|[;\s])(animation|transition)\s*:/.test(body))
      .map(([path]) => path)

    expect(moving).toEqual([])
  })
})

describe('the glass material costs nothing to animate', () => {
  it('never transitions or animates, because a blur that moves is blurred every frame', () => {
    // DESIGN-SYSTEM.md §7 allows `opacity` and `transform` only, and a backdrop filter is
    // neither. This is the same rule, stated where it would be broken: the compositor is
    // already scaling, decoding and crossfading on the wall (roadmap 11.2).
    expect(MATERIAL_RULES).not.toMatch(/transition\s*:/)
    expect(MATERIAL_RULES).not.toMatch(/animation\s*:/)
  })

  it('never spends will-change, which is scarce', () => {
    // `will-change: backdrop-filter` pins a full-size compositing layer for as long as the
    // pane exists rather than for the length of an animation there is not. The wall spends
    // it on the things that genuinely move and that is the whole budget.
    expect(MATERIAL_RULES).not.toMatch(/will-change/)

    const spenders = entries
      .filter(([, css]) => /will-change\s*:[^;]*(backdrop-filter|filter)/.test(css))
      .map(([path]) => path)

    expect(spenders).toEqual([])
  })
})

/**
 * The budget's CSS half, pinned — roadmap 11.3, and the tint tiers of 11.2.
 *
 * Three blocks send a surface all the way to the opaque tier, and every one of them has to
 * switch off the filter *and* every tint a tier can select. A block that forgot one would
 * leave a pane translucent with no blur behind it, which is the exact failure roadmap 11.1
 * names: "not a transparent pane that becomes unreadable".
 */
describe('the glass budget switches the whole material off, every way it can be reached', () => {
  /**
   * The two named tints, read off the stylesheet rather than listed here.
   *
   * A third tier added tomorrow declares a third tint, and this sweep picks it up — which
   * is what stops the assertions below from being a list that is complete on the day it is
   * written and quietly partial afterwards.
   */
  const TINTS = [...withoutComments(TOKENS).matchAll(/(--glass-tint-[a-z-]+):/g)]
    .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
    .filter((name, index, all) => all.indexOf(name) === index)

  const FALLS_BACK = [
    [
      'a browser with no backdrop-filter at all',
      /@supports not \(\(backdrop-filter:.+\) or \(-webkit-backdrop-filter:.+\)\)/,
      true,
    ],
    [
      'a person who asked for less transparency or more contrast',
      /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\)/,
      true,
    ],
    ['the room, by the budget', /\[data-glass='opaque'\]/, false],
  ] as const

  // Comments stripped, or a tier described in prose would satisfy a tier that is missing
  // from the stylesheet — which is the failure mode this whole file is about.
  const RULES = withoutComments(TOKENS)

  const blockAt = (pattern: RegExp): string => {
    const from = RULES.search(pattern)
    expect(from, 'the tier is missing entirely').toBeGreaterThanOrEqual(0)
    return RULES.slice(from, RULES.indexOf('}', RULES.indexOf('{', from) + 1) + 1)
  }

  it('finds the tints the tiers select, rather than sweeping an empty list', () => {
    expect(TINTS.length).toBeGreaterThanOrEqual(2)
  })

  it.each(FALLS_BACK)('has a tier for %s', (_reason, pattern) => {
    expect(RULES).toMatch(pattern)
  })

  it.each(FALLS_BACK)('gives the tier for %s both declarations, not one', (_reason, pattern) => {
    // Per tier rather than by counting, because a count of three is satisfied by three
    // copies inside one block. A tier that switched off the filter and left the tint
    // translucent would be the exact failure roadmap 11.1 names — a transparent pane with
    // nothing behind it — and it is the plausible half to forget.
    const block = blockAt(pattern)

    expect(block).toMatch(/--glass-filter:\s*none\s*;/)
    expect(block).toMatch(/--glass-tint(?:-[a-z-]+)?:\s*var\(--glass-opaque\)\s*;/)
  })

  /**
   * The bug this was written for, and it was live for the length of one commit.
   *
   * A tier is a declaration on a *descendant* of `:root` — the surface element — and for
   * itself and its subtree a descendant always wins, whatever the specificity of the two
   * selectors. So a `@media (prefers-contrast: more)` block that set `--glass-tint`
   * directly would be discarded on every surface carrying a tier, and the guest who asked
   * for more contrast would be handed the translucent pane they asked not to have. The
   * fallbacks therefore move the named tints, and the tiers stay aliases that follow.
   */
  it.each(FALLS_BACK.filter(([, , atRoot]) => atRoot))(
    'reaches a tier set on a surface element, for %s',
    (_reason, pattern) => {
      const block = blockAt(pattern)

      for (const tint of TINTS) {
        expect(block, `${tint} is left translucent by this fallback`).toMatch(
          new RegExp(`${tint}:\\s*var\\(--glass-opaque\\)\\s*;`),
        )
      }
      // And the alias is never written directly, which is what would shadow the above.
      expect(block).not.toMatch(/--glass-tint:\s*var/)
    },
  )

  it('selects a declared tint from every tier, rather than inventing a value', () => {
    // Each tier is an alias, so there is exactly one raw alpha per floor in the whole
    // product. A tier that spelled out `oklch(… / 0.8)` would be a fourth grey arriving in
    // the one shape section 2 cannot see coming.
    const tiers = [...RULES.matchAll(/\[data-glass='[a-z]+'\]\s*\{([^}]*)\}/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    )

    expect(tiers.length).toBeGreaterThanOrEqual(2)
    for (const tier of tiers) {
      expect(tier).not.toMatch(/oklch\(/)
      expect(tier).toMatch(/--glass-tint:\s*var\(--glass-[a-z-]+\)\s*;/)
    }
  })

  it('asks about the prefixed property too, or several years of iPhones lose the blur', () => {
    // Safari carried `backdrop-filter` behind `-webkit-` until 18 and the browsers in
    // scope start at 15.4 (DESIGN-SYSTEM.md §3). Testing only the unprefixed spelling
    // would fall back on the surface most guests are actually holding.
    expect(MATERIAL_RULES).toMatch(/-webkit-backdrop-filter:\s*var\(--glass-filter\)/)
    expect(MATERIAL_RULES).toMatch(/\n\s*backdrop-filter:\s*var\(--glass-filter\)/)
  })
})
