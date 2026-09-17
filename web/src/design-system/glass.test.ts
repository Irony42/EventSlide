import { describe, expect, it } from 'vitest'
import { glassSurfaceProps, glassTierFor, type GlassSurface } from './glass'

/**
 * The budget's rule — roadmap 11.3.
 *
 * Small enough to read in one line and worth its own test for exactly that reason: it is
 * the decision "if glass costs frames on the projector, the wall gets the opaque fallback
 * and the guest surfaces keep the blur", and the value of deciding it in advance is nil
 * unless something fails when it is quietly changed.
 */
describe('which surfaces can afford the blur', () => {
  const SURFACES: readonly GlassSurface[] = ['guest', 'host', 'wall']

  it.each(['guest', 'host'] as const)('%s keeps the blur', (surface) => {
    // The guest's phone and the host's laptop show panes over content that is still
    // between interactions, so the compositor blurs the backdrop once and keeps it.
    expect(glassTierFor(surface)).toBe('blur')
  })

  it('the room takes the opaque fallback, decided here rather than at a wedding', () => {
    // The wall is the one surface whose content never stops moving: a crossfade, Ken
    // Burns, and since roadmap 1.4 a video clip decoding under both. A blur there is
    // recomputed every frame, at full screen, on a venue mini-PC nobody is watching.
    expect(glassTierFor('wall')).toBe('opaque')
  })

  it('spreads nothing at all on a surface that keeps the blur', () => {
    // Absent rather than `data-glass="blur"`: a surface on the default tier has to render
    // the DOM it rendered before this existed, which is the same promise an unthemed
    // event makes and what lets the wall's committed baselines stay committed.
    expect(glassSurfaceProps('guest')).toEqual({})
    expect(glassSurfaceProps('host')).toEqual({})
  })

  it('marks the room, because the marker is what tokens.css re-declares the material on', () => {
    expect(glassSurfaceProps('wall')).toEqual({ 'data-glass': 'opaque' })
  })

  it('decides the same way for every surface there is, and the list is the decision', () => {
    // The whole rule as one table, so that changing it is visible as a changed table
    // rather than as a changed ternary. `toContain(['blur','opaque'])` was here first and
    // could not fail — the return type already says that much.
    expect(SURFACES.map((surface) => [surface, glassTierFor(surface)])).toEqual([
      ['guest', 'blur'],
      ['host', 'blur'],
      ['wall', 'opaque'],
    ])
  })
})
