import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'
import {
  accentFailure,
  accentHueRange,
  accentPalette,
  createEventTheme,
  CURATED_ACCENT_HUES,
  DEFAULT_EVENT_THEME,
  isThemeFonts,
  isThemeFrame,
  isThemeMaterial,
  restoreEventTheme,
  THEME_FONTS,
  THEME_FRAMES,
  THEME_MATERIALS,
  type AccentPalette,
  type EventThemeProps,
} from './eventTheme'

/**
 * The rule that decides whether a host's palette may reach a projector.
 *
 * Roadmap 2.2's stated constraint, and the reason theming is domain code: a stylesheet
 * cannot refuse anything, so without this the feature is "let a host make the wall
 * unreadable, from a form, in one click".
 */

const aTheme = (patch: Partial<EventThemeProps> = {}): EventThemeProps => ({
  ...DEFAULT_EVENT_THEME,
  ...patch,
})

/** A palette the derivation would never produce, for the branches it can never reach. */
const aPalette = (patch: Partial<AccentPalette> = {}): AccentPalette => ({
  ...accentPalette(305),
  ...patch,
})

describe('the accent palette a hue produces', () => {
  it('moves the hue and nothing else, which is what makes the rule decidable', () => {
    const palette = accentPalette(250)

    expect(palette.accent.h).toBe(250)
    expect(palette.strong.h).toBe(250)
    expect(palette.ink.h).toBe(250)
    // The design system derives states by lightness: darker for the pressed state, and
    // an ink dark enough to be read on both.
    expect(palette.strong.l).toBeLessThan(palette.accent.l)
    expect(palette.ink.l).toBeLessThan(palette.strong.l)
  })
})

describe('accentFailure', () => {
  it('passes a palette the product actually derives', () => {
    expect(accentFailure(accentPalette(305))).toBeNull()
  })

  it('refuses ink that cannot be read on the button it is written on', () => {
    // 7:1 is the design system's own target for this pair. A host who could reach it
    // would have made the one control a guest has to find the hardest thing on the page
    // to read.
    const failure = accentFailure(aPalette({ ink: { l: 0.7, c: 0.02, h: 305 } }))

    expect(failure?.code).toBe('eventTheme.accentUnreadable')
    expect(failure?.details['on']).toBe('accent')
    expect(failure?.details['required']).toBe(7)
  })

  it('refuses ink that survives the button at rest but not under a finger', () => {
    // The hover state is darker, and a ratio that only holds at rest is a button that
    // becomes unreadable the moment somebody presses it.
    const failure = accentFailure(
      aPalette({
        accent: { l: 0.98, c: 0.01, h: 305 },
        strong: { l: 0.32, c: 0.01, h: 305 },
        ink: { l: 0.18, c: 0.02, h: 305 },
      }),
    )

    expect(failure?.code).toBe('eventTheme.accentUnreadable')
    expect(failure?.details['on']).toBe('accent-strong')
    expect(failure?.details['required']).toBe(4.5)
  })

  it('refuses an accent that would wear the failure colour', () => {
    // 22 degrees is `--danger`. An accent there makes "press this" and "that went wrong"
    // the same signal to a room ten metres away, under a lamp that has been on since six.
    const failure = accentFailure(accentPalette(30))

    expect(failure?.code).toBe('eventTheme.accentTooCloseToStatus')
    expect(failure?.details['conflictsWith']).toBe('danger')
    expect(failure?.details['minimum']).toBe(0.11)
  })

  it('names which status colour was crowded, and by how much, so the host knows which way to move', () => {
    const near = accentFailure(accentPalette(160))

    expect(near?.details['conflictsWith']).toBe('success')
    // Oklab distance, not degrees: the number a host reads is the one the rule judged.
    expect(near?.details['separation']).toBeCloseTo(0.044, 3)
  })

  it('refuses the tightest pairs the old angle rule allowed', () => {
    /**
     * Hue 125 sat at exactly thirty degrees from `--success` and passed, while being
     * 0.095 away in Oklab — the closest pair the angle rule permitted, and the one that
     * collapses onto `--danger` for a deuteranopic viewer. 185 is its mirror. Neither is
     * reachable from the picker; both were reachable over the API.
     */
    for (const hue of [125, 185]) {
      expect(accentFailure(accentPalette(hue))?.code).toBe('eventTheme.accentTooCloseToStatus')
    }
  })

  it('refuses a hue wearing a status colour’s own angle, for its likeness rather than its angle', () => {
    // 85 degrees *is* `--warning`, but at the accent's lightness and chroma it measures
    // 0.102 away — refused on the distance that decides, not on the angle that did not.
    const failure = accentFailure(accentPalette(85))

    expect(failure?.details['conflictsWith']).toBe('warning')
    expect(failure?.details['separation']).toBeCloseTo(0.102, 3)
  })

  it('leaves every curated accent standing, so a status token cannot move under the catalogue', () => {
    /**
     * The guard that makes the floor safe to tighten: the four hues the picker offers are
     * asserted here, so moving `--success` a few degrees or raising the minimum breaks
     * the build rather than a host's save. Teal is the tightest of the four at 0.120 —
     * not rose, which reads as the likely one.
     */
    for (const hue of Object.values(CURATED_ACCENT_HUES)) {
      expect(accentFailure(accentPalette(hue))).toBeNull()
    }
  })

  it('refuses an accent that would wear the warning colour', () => {
    expect(accentFailure(accentPalette(95))?.details['conflictsWith']).toBe('warning')
  })
})

describe('createEventTheme', () => {
  it('accepts the default, which is what every event rendered before this existed', () => {
    const theme = createEventTheme(DEFAULT_EVENT_THEME)

    expect(theme.ok).toBe(true)
  })

  it.each(Object.entries(CURATED_ACCENT_HUES))(
    'accepts %s, one of the hues the host’s picker offers',
    (_name, hue) => {
      // The picker is an affordance and this rule is the guard; an option the guard
      // refuses would be a form that cannot be submitted.
      expect(createEventTheme(aTheme({ accentHue: hue })).ok).toBe(true)
    },
  )

  it.each([[-1], [360], [305.5], [Number.NaN]])(
    'refuses %s, which is not a point on the hue circle',
    (accentHue) => {
      const theme = createEventTheme(aTheme({ accentHue }))

      expect(theme.ok).toBe(false)
      if (theme.ok) return
      expect(theme.error.code).toBe('eventTheme.accentHueInvalid')
      expect(theme.error.details).toEqual({ min: 0, max: 359 })
    },
  )

  it('refuses a hue the legibility rule rejects, rather than moving it to a safe one', () => {
    // Silent correction is the failure mode this replaces: a host who sees a colour they
    // did not pick cannot tell whether the form saved, so they try again.
    const theme = createEventTheme(aTheme({ accentHue: 160 }))

    expect(theme.ok).toBe(false)
    if (theme.ok) return
    expect(theme.error.kind).toBe('invalid')
    expect(theme.error.code).toBe('eventTheme.accentTooCloseToStatus')
  })

  it.each(THEME_FONTS)('accepts the %s pairing', (fonts) => {
    expect(createEventTheme(aTheme({ fonts })).ok).toBe(true)
  })

  it.each(THEME_FRAMES)('accepts the %s frame', (frame) => {
    expect(createEventTheme(aTheme({ frame })).ok).toBe(true)
  })

  it('treats both ends of the circle as points on it, and nothing past either', () => {
    // The bound the boundary schema imports rather than restates, asserted through the
    // check that is only about shape — reading the constant back would pass for any value
    // the schema also happened to import.
    //
    // Deliberately not through `createEventTheme`: hue 0 *is* a point on the circle and
    // is not a colour a host may have, because it sits inside `--danger`. Shape and taste
    // are different questions and this one is shape.
    //
    // Asserted on what the read path *keeps* rather than on whether it refuses, because
    // it no longer refuses anything: a value on the circle is returned as stored, and one
    // past either end is replaced by the default.
    const restoredHue = (accentHue: number): number => {
      const restored = restoreEventTheme(aTheme({ accentHue }))
      return restored.ok ? restored.value.accentHue : Number.NaN
    }

    expect(restoredHue(accentHueRange.min)).toBe(accentHueRange.min)
    expect(restoredHue(accentHueRange.max)).toBe(accentHueRange.max)
    expect(restoredHue(accentHueRange.min - 1)).toBe(DEFAULT_EVENT_THEME.accentHue)
    expect(restoredHue(accentHueRange.max + 1)).toBe(DEFAULT_EVENT_THEME.accentHue)
  })
})

describe('restoreEventTheme', () => {
  it('keeps a stored hue the legibility rule would now refuse', () => {
    // The asymmetry with `createEventTheme`, and the reason it exists: those constants are
    // numbers somebody will tighten, and every stored theme was chosen under the old ones.
    // Judging a stored choice by a rule that has since moved turns one edit into an
    // unreadable event — with the host's own way out, the settings page, down too.
    const stored = aTheme({ accentHue: 160 })

    expect(createEventTheme(stored).ok).toBe(false)
    expect(restoreEventTheme(stored).ok).toBe(true)
  })

  it('renders the default rather than refusing a hue that is not a point on the circle', () => {
    // Shape is not taste, but the read path still may not refuse: a stored 400 was
    // written by something that is not this product, and failing here would take the
    // wall, the join page and the settings page down for that event over a colour.
    // There is no host choice to lose, so the event renders in violet and says nothing.
    expect(restoreEventTheme(aTheme({ accentHue: 400 })).ok).toBe(true)
    expect(restoreEventTheme(aTheme({ accentHue: 305.5 })).ok).toBe(true)
  })
})

describe('the shipped hues', () => {
  it('starts on the accent tokens.css already declares, so an unthemed event is unchanged', () => {
    expect(DEFAULT_EVENT_THEME).toEqual({
      accentHue: 305,
      fonts: 'sans',
      frame: 'soft',
      material: 'glass',
    })
    expect(CURATED_ACCENT_HUES['violet']).toBe(DEFAULT_EVENT_THEME.accentHue)
  })

  it.each(Object.entries(CURATED_ACCENT_HUES))(
    '%s reads at ten metres: its ink clears 7:1 on the accent',
    (_name, hue) => {
      const palette = accentPalette(hue)

      expect(contrastRatio(palette.ink, palette.accent)).toBeGreaterThanOrEqual(7)
    },
  )

  it('offers hues a host can actually tell apart', () => {
    // Four options that differ by a few degrees would be a picker with one choice in it.
    const hues = Object.values(CURATED_ACCENT_HUES).sort((a, b) => a - b)
    const gaps = hues.slice(1).map((hue, index) => hue - (hues[index] as number))

    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(40)
  })
})

describe('narrowing a value read back from storage', () => {
  it.each(THEME_FONTS)('recognises %s as a font pairing', (value) => {
    expect(isThemeFonts(value)).toBe(true)
  })

  it.each(THEME_FRAMES)('recognises %s as a frame style', (value) => {
    expect(isThemeFrame(value)).toBe(true)
  })

  it.each([['comic'], [null], [7], [undefined]])('refuses %s as a font pairing', (value) => {
    expect(isThemeFonts(value)).toBe(false)
  })

  it.each([['oval'], [null], [7], [undefined]])('refuses %s as a frame style', (value) => {
    expect(isThemeFrame(value)).toBe(false)
  })

  it.each(THEME_MATERIALS)('recognises %s as a material', (value) => {
    expect(isThemeMaterial(value)).toBe(true)
  })

  it.each([['opaque'], ['frosted'], [null], [true], [undefined]])(
    'refuses %s as a material',
    (value) => {
      // `opaque` is the tier's name in the design system and deliberately not the theme's:
      // one is what the browser resolved, the other is what the host asked for, and a blob
      // carrying the first was written by something reading the wrong vocabulary.
      expect(isThemeMaterial(value)).toBe(false)
    },
  )
})

describe('the material a host chooses for their panes', () => {
  it('ships on, because that is what every event already renders', () => {
    // The same promise the accent, the pairing and the frame make: an event that chose
    // nothing renders the DOM it rendered before the field existed. A default of `plain`
    // would silently strip the material from every gallery on the box at the next deploy.
    expect(DEFAULT_EVENT_THEME.material).toBe('glass')
  })

  it.each(THEME_MATERIALS)('lets a host choose %s', (material) => {
    expect(createEventTheme(aTheme({ material })).ok).toBe(true)
  })

  it('is not judged on legibility, because the opaque tier is the better ground', () => {
    // Stated as a test rather than only as a comment. Turning the material off replaces a
    // tint at 0.92–0.95 alpha with the same colour at 1.0, so every ink on a pane gains
    // contrast — DESIGN-SYSTEM.md §13 derives both translucent floors by measuring how
    // close they come to exactly this surface. A hue the rule refuses is refused whichever
    // material it is wearing, and a hue it accepts is accepted the same way: the two
    // decisions are independent, and a rule that made them interact would be inventing one.
    expect(createEventTheme(aTheme({ accentHue: 160, material: 'plain' })).ok).toBe(false)
    expect(createEventTheme(aTheme({ accentHue: 250, material: 'plain' })).ok).toBe(true)
  })

  it('keeps a stored choice on the read path rather than resetting it', () => {
    // `restoreEventTheme` is lenient about the *hue* and about nothing else. A host who
    // turned the material off did so on purpose, and a rule tightened on Tuesday must not
    // put a blur back on their wedding on Saturday.
    const restored = restoreEventTheme(aTheme({ material: 'plain' }))

    expect(restored.ok && restored.value.material).toBe('plain')
  })

  it('loses a stored choice when the hue beside it is not a point on the circle', () => {
    // The cost of the fallback above, named rather than hidden: a theme that shape-fails
    // is replaced **whole**, so a hand-edited hue takes the material back to the default
    // with it. That is right — a blob that shape-fails was not written by this product, so
    // there is no host choice in it to keep — but it is worth a test saying which way it
    // goes, because the alternative reading is "keep the parts that still parse".
    const restored = restoreEventTheme(aTheme({ accentHue: 400, material: 'plain' }))

    expect(restored.ok && restored.value).toEqual(DEFAULT_EVENT_THEME)
  })
})

describe('a stored theme this product did not write', () => {
  /**
   * A cosmetic field must never be able to take an event off the air. Before this, a hue
   * outside the circle threw out of `restoreEventTheme`, which the repository turns into
   * a corrupt row — failing `findById`, and with it the wall, the join page and the very
   * settings page a host would have used to pick another colour.
   */
  it.each([[400], [-5], [305.5], [Number.NaN]])(
    'falls back to the default rather than refusing, for %s',
    (accentHue) => {
      const restored = restoreEventTheme({ ...DEFAULT_EVENT_THEME, accentHue })

      expect(restored.ok).toBe(true)
      expect(restored.ok && restored.value).toEqual(DEFAULT_EVENT_THEME)
    },
  )

  it('still refuses the same value from a host who is choosing it', () => {
    // The asymmetry is the point: lenient on read, strict on write.
    expect(createEventTheme({ ...DEFAULT_EVENT_THEME, accentHue: 400 }).ok).toBe(false)
  })
})
