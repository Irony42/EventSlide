import { describe, expect, it } from 'vitest'
import { glassSurfaceProps, glassTierFor, type GlassBackdrop, type GlassSurface } from './glass'

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
