import { describe, expect, it } from 'vitest'
import { SHED_ORDER, type BudgetLevel } from './budget'
import {
  glassMaterialProps,
  glassSurfaceProps,
  glassTierFor,
  type GlassBackdrop,
  type GlassMaterialProps,
  type GlassMaterial,
  type GlassSurface,
  type GlassSurfaceProps,
  type GlassTier,
} from './glass'

/**
 * Which of the two markers a pane actually inherits from.
 *
 * The browser does this, not us: both markers declare the same custom properties, and a
 * pane resolves them from the nearest ancestor that declared them. It is a model of a CSS
 * fact and therefore lives here rather than in `glass.ts`, which ships no such function —
 * what it buys is that the rule, stated once and applied by two components that never meet,
 * can be asserted against the composition they actually produce. The real cascade is read
 * off a real browser in `tests/e2e/journeys/glass-budget.spec.ts`.
 */
const glassTierRendered = (shell: GlassSurfaceProps, themed: GlassMaterialProps): GlassTier =>
  themed['data-glass'] ?? shell['data-glass'] ?? 'photo'

/**
 * The two rules the material is served by — roadmap 11.3 and 11.2.
 *
 * Small enough to read in one line each and worth their own test for exactly that reason.
 * One is "if glass costs frames on the projector, the wall gets the opaque fallback and the
 * guest surfaces keep the blur"; the other is "a pane is only as translucent as what can be
 * painted underneath it allows". The value of deciding either in advance is nil unless
 * something fails when it is quietly changed.
 */
describe('which surfaces can afford the blur', () => {
  const SURFACES: readonly GlassSurface[] = ['guest', 'host', 'wall']

  it.each(['guest', 'host'] as const)('%s keeps the blur', (surface) => {
    // The guest's phone and the host's laptop show panes over content that is still
    // between interactions, so the compositor blurs the backdrop once and keeps it.
    expect(glassTierFor(surface, 'ground')).not.toBe('opaque')
    expect(glassTierFor(surface, 'photo')).not.toBe('opaque')
  })

  it('the room takes the opaque fallback, decided here rather than at a wedding', () => {
    // The wall is the one surface whose content never stops moving: a crossfade, Ken
    // Burns, and since roadmap 1.4 a video clip decoding under both. A blur there is
    // recomputed every frame, at full screen, on a venue mini-PC nobody is watching.
    expect(glassTierFor('wall', 'photo')).toBe('opaque')
  })

  it('the room takes it whatever is behind the pane, so the two rules cannot argue', () => {
    // A surface that cannot afford the filter has no tint to choose. If the backdrop could
    // override the budget, an address classified `ground` would put a blur back on the
    // projector — which is the one outcome roadmap 11.3 exists to prevent.
    expect(glassTierFor('wall', 'ground')).toBe('opaque')
  })

  it('spreads nothing at all on a surface held to the strict floor', () => {
    // Absent rather than `data-glass="photo"`: the floor that survives a photograph is what
    // `tokens.css` already declares on `:root`, so a surface on it renders the DOM it
    // rendered before any of this existed. That is the same promise an unthemed event
    // makes and what lets the wall's committed baselines stay committed.
    expect(glassSurfaceProps('guest', 'photo')).toEqual({})
    expect(glassSurfaceProps('host', 'photo')).toEqual({})
  })

  it('holds a surface that says nothing to the strict floor', () => {
    // The default, and the only safe direction for one to fail in: a screen nobody
    // classified is a screen nobody looked at, and the translucent tier has to be claimed.
    expect(glassTierFor('guest')).toBe('photo')
    expect(glassSurfaceProps('host')).toEqual({})
  })

  it('marks the translucent tier, because the marker is what tokens.css re-declares on', () => {
    expect(glassSurfaceProps('guest', 'ground')).toEqual({ 'data-glass': 'ground' })
    expect(glassSurfaceProps('host', 'ground')).toEqual({ 'data-glass': 'ground' })
  })

  it('marks the room, because the marker is what tokens.css re-declares the material on', () => {
    expect(glassSurfaceProps('wall', 'photo')).toEqual({ 'data-glass': 'opaque' })
  })

  it('decides the same way for every case there is, and the table is the decision', () => {
    // The whole rule as one table, so that changing it is visible as a changed table
    // rather than as a changed expression. `toContain(['blur','opaque'])` was here first
    // and could not fail — the return type already says that much.
    const BACKDROPS: readonly GlassBackdrop[] = ['ground', 'photo']
    const decisions = SURFACES.flatMap((surface) =>
      BACKDROPS.map((backdrop) => [surface, backdrop, glassTierFor(surface, backdrop)]),
    )

    expect(decisions).toEqual([
      ['guest', 'ground', 'ground'],
      ['guest', 'photo', 'photo'],
      ['host', 'ground', 'ground'],
      ['host', 'photo', 'photo'],
      ['wall', 'ground', 'opaque'],
      ['wall', 'photo', 'opaque'],
    ])
  })
})

/**
 * The host's switch, and the two rules that say who wins when three answers disagree.
 *
 * Three things can now want a say in whether a pane is glass: the host chose a look for
 * their event, the device stated a capability or a preference, and the budget measured a
 * machine that is not coping. Both rules below were sentences in a design document first,
 * which is the exact shape of defect a mutation audit has found in this repository more
 * than once — so each is a test that fails when the sentence stops being true.
 */
describe('the host’s switch over the material', () => {
  const SURFACES: readonly GlassSurface[] = ['guest', 'host', 'wall']
  const BACKDROPS: readonly GlassBackdrop[] = ['ground', 'photo']
  const LEVELS: readonly BudgetLevel[] = [0, 1, 2, 3]
  const MATERIALS: readonly GlassMaterial[] = ['glass', 'plain']

  const everyCase = SURFACES.flatMap((surface) =>
    BACKDROPS.flatMap((backdrop) => LEVELS.map((level) => [surface, backdrop, level] as const)),
  )

  it.each(everyCase)(
    'a host who turned the material off is not overruled on %s / %s / level %i',
    (surface, backdrop, level) => {
      // **The host's "off" is final.** Nothing may put the material back: not a device that
      // can afford the filter, not a frame rate that recovered, not an address that claims
      // the translucent floor. Degradation in this codebase is one-way and so is this — a
      // host who chose the plainer surface for their evening did not ask to be second-
      // guessed by whichever machine happened to be holding the page.
      expect(glassTierFor(surface, backdrop, level, 'plain')).toBe('opaque')
    },
  )

  it.each(everyCase.filter(([, , level]) => level > SHED_ORDER.indexOf('glass')))(
    'a host who asked for the material still loses it on %s / %s / level %i',
    (surface, backdrop, level) => {
      // **The budget wins over the host.** Shedding glass is a health answer rather than a
      // taste one: a wall holding its frame rate in front of a hundred people, and an upload
      // screen that answers a thumb, both outrank a preference about how the product looks.
      // A host who asked for glass on a machine that cannot afford it gets the opaque tier.
      expect(glassTierFor(surface, backdrop, level, 'glass')).toBe('opaque')
    },
  )

  it('leaves a capable machine exactly where it was when the host asked for glass', () => {
    // The other half of the rule above, and the reason it is not simply "always opaque":
    // the host's "on" is what every event has today, and it must still mean the material.
    expect(glassTierFor('guest', 'photo', 0, 'glass')).toBe('photo')
    expect(glassTierFor('guest', 'ground', 0, 'glass')).toBe('ground')
  })

  it('lets the host’s answer take the material away and never put it back', () => {
    // The mechanism behind both rules, and the one line where they could be broken by
    // somebody being helpful. The shell carries the machine's answer; a themed surface is a
    // **descendant** of it, and a tier declared on a descendant wins for its own subtree
    // whatever the specificity (DESIGN-SYSTEM.md §13). So the only value a themed surface
    // may ever declare is the opaque one: a surface that spelled its tier out in full —
    // `data-glass="ground"` for a host who chose glass, say — would put a blur back on a
    // machine that had already given it up, and on the projector.
    expect(glassMaterialProps('glass')).toEqual({})
    expect(glassMaterialProps('plain')).toEqual({ 'data-glass': 'opaque' })
  })

  it.each(
    everyCase.flatMap(([surface, backdrop, level]) =>
      MATERIALS.map((material) => [surface, backdrop, level, material] as const),
    ),
  )(
    'renders the tier the rule names on %s / %s / level %i / %s',
    (surface, backdrop, level, material) => {
      // The two markers are written by two components that never meet — `AppShell`, which
      // knows the machine, and the themed surface below it, which knows the event. What a
      // pane actually inherits is whichever of them is nearer, and that composition is
      // where a rule stated in one place and applied in two goes wrong. So it is asserted
      // against the rule itself, for every case there is.
      expect(
        glassTierRendered(
          glassSurfaceProps(surface, backdrop, level),
          glassMaterialProps(material),
        ),
      ).toBe(glassTierFor(surface, backdrop, level, material))
    },
  )
})
