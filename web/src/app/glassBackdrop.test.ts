import { describe, expect, it } from 'vitest'
import ROUTER from './router.tsx?raw'
import TOKENS from '../design-system/tokens.css?raw'
import { glassBackdropFor, ROUTE_BACKDROPS } from './glassBackdrop'
import {
  lightestHue,
  luminanceOf,
  parseOklchTokens,
  srgb,
  type Oklch,
} from '../design-system/testing/srgb'

/**
 * The guard that makes the tier structural rather than declarative — roadmap 11.2.
 *
 * `ROUTE_BACKDROPS` is a table somebody wrote, and a table somebody wrote is a claim. The
 * claim is about the whole subtree of a page — "nothing brighter than a primary button can
 * be painted under a pane here" — which is exactly the kind of thing that is true when it
 * is written and false two features later, invisibly, because the change that broke it was
 * three lines in a component nobody connected to a stylesheet.
 *
 * So the claim is checked against the thing it is a claim about. This walks the real import
 * graph from each page module and refuses the translucent tier to any address that can
 * reach:
 *
 * - an `<img>` or a `<video>`, which is an unknown number of unknown pixels; or
 * - a background fill brighter than `--accent` at its lightest hue, which is the backdrop
 *   `tokens.contrast.test.ts` derives the translucent floor against.
 *
 * It is the same kind of guard as the layer boundaries in CLAUDE.md §2 and the material
 * sweep in `glass.material.test.ts`: mechanical, read off the source, and failing on a file
 * that did not exist when it was written.
 *
 * **The second condition is the one worth reading.** "No guest photograph on this screen"
 * was the obvious rule and it is not sufficient: the event page prints a QR plate, which is
 * `--text-primary` — a near-white field, because a code has to be dark-on-light to scan —
 * and a contrast ratio cannot tell that apart from a white dress in full sun. That address
 * is on the strict floor because of this check, not because anybody remembered.
 */

/** Every module the web app ships, as source, keyed on a path rooted at `web/src`. */
const MODULES = import.meta.glob<string>('../**/*.{ts,tsx,css}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Glob keys arrive relative to this file: a sibling as `./x`, a cousin as `../features/x`. */
const named = (path: string): string => path.replace(/^\.\//, 'app/').replace(/^\.\.\//, '')

const sources = new Map(Object.entries(MODULES).map(([path, source]) => [named(path), source]))

/**
 * Comments stripped before anything is looked for.
 *
 * Not fussiness: `WallLayouts.tsx` discusses how many `<img>` elements a layout may hold and
 * `SlideLayer.tsx` explains what happens to a `<video>` on the outgoing layer. A sweep that
 * counted prose would put half the wall's modules in the wrong category, and — worse — it
 * would be the kind of failure somebody fixes by deleting the comment.
 *
 * `//` needs a boundary in front of it so that `https://` survives, and the block form
 * needs one for exactly the same reason — which the first version of this did not give
 * it. An `accept` attribute whose value ends in a slash-star reads as an opening comment
 * to an unanchored sweep, which then deletes everything up to the next closing pair
 * anywhere in the file. Measured on this tree rather than assumed: 646 bytes of
 * `ClipComposer.tsx` (the attribute is `video/` + star) and 1 225 bytes of
 * `glassBackdrop.ts` itself, where the opener is the route string for the join
 * catch-all. `PhotoPicker.tsx` happens to lose nothing, because no closing pair follows
 * its attribute — which is the point: whether the fault bites depends on what comes
 * later in the file, so it is invisible until the day somebody adds an element below it.
 *
 * Nothing on a `ground` route is hidden by it today, and that is luck rather than design.
 * The failure is silent and points at the loose floor, so it is the direction that costs
 * a guest's photograph its legibility. Requiring a boundary costs nothing: a real comment
 * is preceded by a line start, whitespace, or one of `{ ; ( ,`.
 */
const withoutComments = (source: string): string =>
  source.replace(/(^|[\s{;(,])\/\*[\s\S]*?\*\//g, '$1').replace(/(^|[\s(])\/\/[^\n]*/g, '$1')

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

/** Relative specifier → a key in `sources`, or `null` for a bare package import. */
const resolve = (from: string, specifier: string): string | null => {
  if (!specifier.startsWith('.')) return null

  const segments = from.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '.') continue
    else if (part === '..') segments.pop()
    else segments.push(part)
  }

  const base = segments.join('/').replace(/\?raw$/, '')
  return (
    EXTENSIONS.map((extension) => `${base}${extension}`).find((path) => sources.has(path)) ?? null
  )
}

/**
 * What one module pulls in: static imports, `import()` calls, and `composes …` / `@import`
 * in CSS.
 *
 * The CSS half matters — a page reaches a stylesheet, and a stylesheet is where a fill is
 * declared. Following `composes` as well means a class borrowed from another module carries
 * that module's declarations into the closure, which is what a browser does too, and
 * `@import` is there for the same reason even though nothing uses one today: a sweep that
 * only knows the constructs already in the tree is a sweep the next construct walks past.
 */
const importsOf = (source: string): readonly string[] => {
  const body = withoutComments(source)
  return [
    ...body.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g),
    ...body.matchAll(/composes:\s*[\w-]+\s+from\s*['"]([^'"]+)['"]/g),
    ...body.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
}

/** Every module reachable from `entry`, `entry` included. */
const closureOf = (entry: string): ReadonlySet<string> => {
  const seen = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined || seen.has(current)) continue
    seen.add(current)

    const source = sources.get(current)
    if (source === undefined) continue
    for (const specifier of importsOf(source)) {
      const resolved = resolve(current, specifier)
      if (resolved !== null && !seen.has(resolved)) queue.push(resolved)
    }
  }

  return seen
}

/**
 * The accent's hue is a variable (roadmap 2.2), so the file is resolved once — the way the
 * browser would — before the palette is read. The angle substituted here is only a starting
 * point: `fieldLuminance` sweeps all 360 for anything accent-derived.
 */
const DECLARED_HUE = /--accent-hue:\s*([\d.]+)\s*;/.exec(TOKENS)?.[1]

if (DECLARED_HUE === undefined) {
  throw new Error('tokens.css declares no --accent-hue; the accent tokens cannot be resolved.')
}

const tokens = parseOklchTokens(TOKENS.replaceAll('var(--accent-hue)', DECLARED_HUE))

const token = (name: string): Oklch => {
  const found = tokens.get(name)
  if (found === undefined) throw new Error(`${name} is not an oklch token in tokens.css`)
  return found
}

/**
 * How bright a token is when it fills an area.
 *
 * An accent-derived token is not one colour but 360 of them (roadmap 2.2), and oklch's `L`
 * does not track relative luminance, so the honest reading of "a primary button" is the
 * button at whichever hue renders lightest. Everything else has the hue it declares.
 */
const fieldLuminance = (name: string, colour: Oklch): number =>
  luminanceOf(srgb(name.startsWith('--accent') ? lightestHue(colour) : colour))

/** The brightest field a pane on the translucent tier is allowed to meet. */
const CEILING = fieldLuminance('--accent', token('--accent'))

/** `--a: var(--b)` in `tokens.css`, so a fill that names an alias can still be measured. */
const ALIASES = new Map(
  [...TOKENS.matchAll(/^\s*(--[a-z-]+):\s*var\(\s*(--[a-z-]+)\s*\)\s*;/gm)].flatMap(
    ([, from, to]) => (from === undefined || to === undefined ? [] : [[from, to] as const]),
  ),
)

/**
 * The colour a fill actually paints, following one hop of aliasing — or `null`.
 *
 * The distinction matters because of what the caller does with `null`. The first version of
 * this check skipped a token it could not parse, which made an unreadable fill *safer* than
 * a readable one: `background: var(--glass-tint)` names an alias rather than a literal
 * `oklch(...)`, so the pane's own ground was measured as nothing at all. Every other
 * unknown answer in this file fails towards the strict floor, and this one failed away from
 * it — quietly, in the direction that hands a photograph the translucent tier.
 */
const resolveFill = (name: string): { readonly name: string; readonly colour: Oklch } | null => {
  const direct = tokens.get(name)
  if (direct !== undefined) return { name, colour: direct }

  const alias = ALIASES.get(name)
  if (alias === undefined) return null

  const target = tokens.get(alias)
  return target === undefined ? null : { name: alias, colour: target }
}

/** Every `background*` declaration's value, whatever the longhand. */
const backgroundValues = (css: string): readonly string[] =>
  [...withoutComments(css).matchAll(/(?:^|[;{\s])background(?:-[a-z]+)?\s*:\s*([^;}]+)/g)].flatMap(
    (match) => (match[1] === undefined ? [] : [match[1]]),
  )

/** Background fills a stylesheet paints, as token names. */
const fillsIn = (css: string): readonly string[] =>
  backgroundValues(css)
    .flatMap((value) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)])
    .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))

/**
 * Elements that paint pixels this stylesheet does not choose.
 *
 * `svg` is deliberately absent: every one in this tree is an inline icon drawn in
 * `currentColor`, and flagging them would put every address on the strict floor and make
 * the guard say nothing. `canvas`, `iframe`, `object` and `embed` are here although nothing
 * uses them, because the cost of listing them now is a word each and the cost of finding
 * out later is a pane that was measured against the wrong backdrop.
 */
const FOREIGN_PIXELS = /<(img|video|canvas|iframe|object|embed)[\s/>]/

/** What in this module's closure makes the translucent tier unsafe, if anything. */
const brightThingsIn = (closure: ReadonlySet<string>): readonly string[] => {
  const found: string[] = []

  for (const path of closure) {
    const source = sources.get(path)
    if (source === undefined) continue
    const body = withoutComments(source)

    if (FOREIGN_PIXELS.test(body)) found.push(`${path} renders an <img> or a <video>`)

    if (!path.endsWith('.css')) {
      // The same elements by their other two spellings. Neither is in this tree, and both
      // are one refactor away from being: `createElement` is what a JSX-free helper emits,
      // and `as="img"` is what a polymorphic primitive takes. A detector that only knows the
      // syntax already written is one the next syntax walks straight past.
      if (/createElement\(\s*['"](?:img|video|canvas|iframe|object|embed)['"]/.test(body))
        found.push(`${path} creates an <img> or a <video> from JavaScript`)
      if (/\bas=["'](?:img|video)["']/.test(body)) found.push(`${path} renders a polymorphic <img>`)
      // An inline background, in the one place the repository still allows inline style for
      // a computed value. A picture set from JavaScript is as unknown as one in an `<img>`.
      // Scoped to components on purpose: the camel-case spellings cannot appear in CSS, but
      // the bare `background` can, and testing for it here reported every stylesheet in the
      // design system as if it were an inline style.
      if (/background(?:Image|Color)\s*:/.test(body)) found.push(`${path} sets a background in JS`)
      continue
    }
    for (const value of backgroundValues(source)) {
      // `url()` is an image, and an image in a stylesheet is no more knowable than one a
      // guest uploaded. Nothing in this tree has one; the check is what keeps that true.
      if (/url\(/.test(value)) found.push(`${path} paints a background image`)
    }
    for (const name of fillsIn(source)) {
      const resolved = resolveFill(name)
      // An unmeasurable fill is an unclassified one, and unclassified has to mean strict —
      // the same answer `glassBackdropFor` gives a pathname it does not recognise.
      if (resolved === null) {
        found.push(`${path} fills with ${name}, which is not a measurable colour`)
        continue
      }
      if (fieldLuminance(resolved.name, resolved.colour) > CEILING)
        found.push(`${path} fills with ${name}`)
    }
  }

  return found.sort()
}

describe('the route table and the router agree about what exists', () => {
  it('covers every address the router declares, and invents none', () => {
    // A table that has drifted from the router is worse than no table: it answers for an
    // address nobody serves, and the address somebody does serve falls to the default.
    //
    // Read off the raw source rather than the stripped copy, and that is not laziness:
    // `path="/join/*"` opens a CSS-style block comment as far as `withoutComments` is
    // concerned, and stripping first swallowed three routes into one. A commented-out
    // `path="…"` would be picked up here, which is the harmless direction to be wrong in.
    const declared = [...ROUTER.matchAll(/path="([^"]+)"/g)]
      .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
      // The one address that renders no shell: it is a `<Navigate>` outside every layout,
      // so there is no surface element for a tier to land on.
      .filter((path) => path !== '/')

    expect([...ROUTE_BACKDROPS.map((route) => route.path)].sort()).toEqual([...declared].sort())
  })

  it('declares every path as a literal, because that is what the table is matched on', () => {
    // The equality above reads `path="…"` and nothing else, so a route written
    // `path={ADMIN_REPORTS}` is invisible to it: the test stays green, the table never gains
    // the address, and `glassBackdropFor` hands it to the catch-all — which is `ground`, the
    // loose floor. An unclassified screen has to fail strict, and the cheapest way to keep
    // that true is to refuse the spelling that hides a screen from the table at all.
    expect([...ROUTER.matchAll(/path=\{/g)].map((match) => match[0])).toEqual([])
  })

  it('names the module the router really renders there, not merely one that exists', () => {
    // The last hole in the chain, and the quiet one. `page` is hand-written, and the check
    // below it only asks whether the file exists — so moving a route onto a different
    // component leaves the table naming the old module, which still exists, and the walk
    // then certifies a subtree nobody renders. The table would be green about the wrong
    // screen, which is worse than having no table: a pane over a photograph at the floor
    // derived for our own ground is exactly the failure 11.1 measured the floor to prevent.
    const elementAt = new Map(
      [
        ...ROUTER.matchAll(/<Route\s+path="([^"]+)"[\s\S]{0,160}?element=\{<([A-Za-z0-9_]+)/g),
      ].flatMap((match) =>
        match[1] === undefined || match[2] === undefined ? [] : [[match[1], match[2]] as const],
      ),
    )

    // Both spellings `router.tsx` uses: an eager named import, and the `lazy(() =>
    // import(...))` every admin screen is behind so a host downloads one console.
    const moduleOf = new Map<string, string>([
      ...[...ROUTER.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)].flatMap(
        ([, names, specifier]) =>
          (names ?? '').split(',').flatMap((raw) => {
            const name = raw.trim()
            return name === '' || specifier === undefined ? [] : [[name, specifier] as const]
          }),
      ),
      ...[
        ...ROUTER.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*lazy\([\s\S]*?import\('([^']+)'\)/g),
      ].flatMap(([, name, specifier]) =>
        name === undefined || specifier === undefined ? [] : [[name, specifier] as const],
      ),
    ])

    for (const route of ROUTE_BACKDROPS) {
      const element = elementAt.get(route.path)
      expect(element, `${route.path} renders no element in router.tsx`).toBeDefined()

      const specifier = moduleOf.get(element ?? '')
      expect(specifier, `${element ?? '?'} is not imported by router.tsx`).toBeDefined()

      expect(
        resolve('app/router.tsx', specifier ?? ''),
        `${route.path} renders ${element ?? '?'}`,
      ).toBe(route.page)
    }
  })

  it('names a page module that exists, for every route', () => {
    // The walk below starts here. A typo would make `closureOf` return a set of one and
    // every assertion under it would pass by looking at nothing.
    for (const route of ROUTE_BACKDROPS) {
      expect(sources.has(route.page), `${route.path} names ${route.page}`).toBe(true)
    }
  })

  it('ranks the way the router ranks, rather than the way the table is ordered', () => {
    // `/admin/events/new` matches `/admin/events/:slug` as well, and the two have different
    // answers. A first-match loop over the table would have returned whichever was written
    // first, which is a bug that shows up as one admin screen with the wrong material.
    expect(glassBackdropFor('/admin/events/new')).toBe('ground')
    expect(glassBackdropFor('/admin/events/mariage-camille')).toBe('photo')
    expect(glassBackdropFor('/admin/events/mariage-camille/moderation')).toBe('photo')
    expect(glassBackdropFor('/admin/events/mariage-camille/settings')).toBe('ground')
    expect(glassBackdropFor('/join/ABCD')).toBe('ground')
    expect(glassBackdropFor('/e/mariage/upload')).toBe('photo')
  })

  it('answers with the strict floor when nothing matches at all', () => {
    // The catch-all covers every address a browser can be at, so this needs a pathname a
    // browser cannot produce — one with no leading slash, which `matchRoutes` refuses
    // outright. The branch is asserted rather than left to inspection because the direction
    // a default fails in is the whole of its value: unclassified has to mean strict.
    expect(glassBackdropFor('un-classified')).toBe('photo')
    // And the catch-all itself is a real answer rather than that fallback.
    expect(glassBackdropFor('/admin/nowhere')).toBe('ground')
  })
})

describe('the import graph walk sees what it claims to see', () => {
  it('reaches past the page module into the components and the stylesheets', () => {
    // Guards that silently walk nothing are the reason this exists at all.
    const closure = closureOf('features/moderation/ModerationPage.tsx')

    expect(closure.size).toBeGreaterThan(10)
    expect(closure).toContain('features/moderation/components/ModerationCard.tsx')
    expect(closure).toContain('features/moderation/components/ModerationToolbar.module.css')
    // Followed through `composes`, which is how a borrowed class brings its own fills.
    expect(closure).toContain('design-system/glass.module.css')
  })

  it('finds the two things a translucent pane cannot survive, where they really are', () => {
    // The detector, pointed at known positives. Without this, "no offenders" below is as
    // green for a broken regex as for a clean product.
    expect(brightThingsIn(closureOf('features/moderation/ModerationPage.tsx'))).toContainEqual(
      expect.stringContaining('ModerationCard.tsx renders an <img>'),
    )
    expect(brightThingsIn(closureOf('features/admin/EventPage.tsx'))).toContainEqual(
      'features/admin/components/EventQrCard.module.css fills with --text-primary',
    )
  })

  it('keeps the source that follows an accept="video/*" attribute', () => {
    // Asserted on the stripper rather than through a misclassified route, because today no
    // route *is* misclassified by it: the two files carrying such an attribute render no
    // `<img>` below it. That makes this latent rather than live, and a latent fault with no
    // test is what this repository keeps shipping.
    //
    // `video/*` reads as an opening block comment to an unanchored sweep, which then deletes
    // everything up to the next `*` + `/` in the file. Measured here: 646 bytes of
    // `ClipComposer.tsx` disappeared, `capture="environment"` among them, and so would any
    // element added below it. The same fault ate 1 225 bytes of `glassBackdrop.ts` itself,
    // where the opener is the route string `'/join/*'` — which is the trap the router test
    // above already had to work around, in a second place nobody looked.
    const composer = sources.get('features/guest-upload/components/ClipComposer.tsx') ?? ''

    expect(composer, 'the component that carries the attribute').toContain('accept="video/*"')
    // Declared after both attributes, so its survival is the whole claim: the sweep took a
    // comment and nothing else.
    expect(withoutComments(composer)).toContain('capture="environment"')
  })
})

describe('a screen may claim the translucent tier only if its subtree earns it', () => {
  const ground = ROUTE_BACKDROPS.filter((route) => route.backdrop === 'ground')

  it('has something to check, rather than an empty list of ground routes', () => {
    expect(ground.length).toBeGreaterThan(5)
  })

  it.each(ground.map((route) => [route.path, route.page] as const))(
    '%s paints nothing brighter than the floor it claims',
    (_path, page) => {
      // The assertion the whole file is for. Marking the moderation queue `ground` fails
      // here, naming `ModerationCard.tsx`, rather than shipping a pane at a floor derived
      // for a backdrop it will never have.
      expect(brightThingsIn(closureOf(page))).toEqual([])
    },
  )

  it('keeps both panes that wear the material on the strict floor', () => {
    // `glass.material.test.ts` lists the two surfaces wearing the material; this says which
    // tier they are actually served on. Both are sticky panes with a guest's photographs
    // moving underneath, which is the case the 0.95 floor was derived for — so the tier
    // split changes nothing about what ships today, and that is the intended answer rather
    // than a shortfall.
    const wearers = [
      'features/guest-upload/GuestUploadPage.module.css',
      'features/moderation/components/ModerationToolbar.module.css',
    ]

    for (const wearer of wearers) {
      const routes = ROUTE_BACKDROPS.filter((route) => closureOf(route.page).has(wearer))
      expect(routes.length, `nothing renders ${wearer}`).toBeGreaterThan(0)
      expect(routes.map((route) => route.backdrop)).not.toContain('ground')
    }
  })
})
