import { describe, expect, it } from 'vitest'
import {
  accentNameFor,
  CURATED_ACCENT_HUES,
  CURATED_ACCENT_NAMES,
  DEFAULT_EVENT_THEME,
  readEventTheme,
  themeSurfaceProps,
} from './eventTheme'
import type { EventThemeDto } from '../lib/api/dto'

/**
 * How a theme reaches a surface, and — more importantly — how it does not reach one.
 *
 * The property worth protecting here is the negative: an event that chose nothing must
 * produce no attribute and no inline style, because the wall's committed visual
 * baselines photograph exactly that DOM.
 */

const aTheme = (overrides: Partial<EventThemeDto> = {}): EventThemeDto => ({
  ...DEFAULT_EVENT_THEME,
  ...overrides,
})

describe('themeSurfaceProps', () => {
  it('gives an unthemed event nothing at all to wear', () => {
    // Not "the default values": nothing. A `data-event-frame="soft"` on an event nobody
    // themed would be a DOM difference on every wall in production for no behaviour.
    expect(themeSurfaceProps(DEFAULT_EVENT_THEME, 'wall')).toEqual({})
  })

  it('gives a surface with no event nothing either', () => {
    // The wall before its first response. There is nothing accent-coloured on screen at
    // that moment, which is what makes "the projector never blinks" true rather than
    // hoped for.
    expect(themeSurfaceProps(null, 'wall')).toEqual({})
  })

  it('hands the wall the hue as an angle, never as a colour', () => {
    const props = themeSurfaceProps(aTheme({ accentHue: 345 }), 'wall')

    expect(props.style).toEqual({ '--accent-hue': '345' })
  })

  it('marks the element the stylesheet has to re-derive the accent on', () => {
    // `--accent` references `--accent-hue`, and a custom property that references another
    // is resolved on the element it is declared on — so moving the hue alone changes
    // nothing anywhere. The marker is what selects the re-declaration in `tokens.css`.
    const props = themeSurfaceProps(aTheme({ accentHue: 345 }), 'wall')

    expect(props['data-event-accent']).toBe('345')
  })

  it('hands the wall the font pairing and the frame style it chose', () => {
    const props = themeSurfaceProps(aTheme({ fonts: 'serif', frame: 'square' }), 'wall')

    // The whole object: an event on the default hue must carry no accent marker either,
    // and asserting two keys would not see one appear.
    expect(props).toEqual({ 'data-event-fonts': 'serif', 'data-event-frame': 'square' })
  })

  it('omits each choice the event left on the default', () => {
    const props = themeSurfaceProps(aTheme({ accentHue: 250 }), 'wall')

    expect(props).toEqual({
      style: { '--accent-hue': '250' },
      'data-event-accent': '250',
    })
  })

  it('dresses both surfaces in an ambiance other than the default (ADR 0010)', () => {
    const theme = aTheme({ ambiance: 'riviera' })

    expect(themeSurfaceProps(theme, 'wall')['data-event-ambiance']).toBe('riviera')
    expect(themeSurfaceProps(theme, 'guest')['data-event-ambiance']).toBe('riviera')
  })

  /** A selector list split on its own commas, not on the ones inside a :is() or a :has(). */
  const topLevelCommas = (list: string): string[] => {
    const parts: string[] = ['']
    let depth = 0
    for (const char of list) {
      if (char === '(') depth++
      if (char === ')') depth--
      if (char === ',' && depth === 0) parts.push('')
      else parts[parts.length - 1] += char
    }
    return parts
  }

  it('keeps the guest ornaments off the wall, which carries its layout marker', async () => {
    // ADR 0010: a fixed string of bulbs over a projected photograph is the one place the
    // ornament would break principle 1, so the selector must exclude the wall.
    const { default: base } = await import('./base.css?raw')
    // Every rule that draws on the page's own pseudo-elements, or pads the body for them.
    const rules = [
      ...base.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(^|\})\s*([^{}@]*body[^{}]*)\{/g),
    ]
      .map(([, , selector]) => (selector ?? '').replace(/\s+/g, ''))
      .filter((selector) => selector.includes('data-event-ambiance'))
    // Five ambiances, each with at least one rule of its own, plus the shared skeleton.
    expect(rules.length).toBeGreaterThanOrEqual(10)
    // Every selector of a comma list, not the list: one bare member would put a strip on the wall.
    for (const selector of rules.flatMap(topLevelCommas)) {
      expect(selector).toContain(':not(:has([data-wall-layout]))')
    }
    // The root look has no marker of its own: it is the body that holds no ambiance at all.
    expect(base.replace(/\s+/g, '')).toContain(
      'body:not(:has([data-event-ambiance]:not([data-template-preview]))):not(:has([data-wall-layout]))::before',
    )
  })

  describe('the host’s own photograph of the venue (ADR 0010, decision 8)', () => {
    const URL_PATH = `/api/events/camille-et-sacha/venue-photo/${'ab'.repeat(32)}`
    const riviera = (groundUrl: string | null) => aTheme({ ambiance: 'riviera', groundUrl })

    it.each(['guest', 'wall'] as const)(
      'hands the %s surface the photograph as an inline custom property, JSON-quoted',
      (surface) => {
        const props = themeSurfaceProps(riviera(URL_PATH), surface)

        expect(props.style).toEqual({ '--ambiance-ground': `url("${URL_PATH}")` })
        expect(props['data-venue-ground']).toBe(surface)
        expect(props['data-event-ambiance']).toBe('riviera')
      },
    )

    it('keeps the accent hue on the same element, in the same style object', () => {
      const props = themeSurfaceProps({ ...riviera(URL_PATH), accentHue: 345 }, 'wall')

      expect(props.style).toEqual({
        '--accent-hue': '345',
        '--ambiance-ground': `url("${URL_PATH}")`,
      })
    })

    it('adds nothing for an event with no photograph, so the bundled one is untouched', () => {
      const props = themeSurfaceProps(riviera(null), 'guest')

      expect(props).not.toHaveProperty('style')
      expect(props).not.toHaveProperty('data-venue-ground')
    })

    it.each([
      ['an absolute URL on another origin', 'https://evil.example/ground.png'],
      ['a protocol-relative one', `//evil.example${URL_PATH}`],
      ['a path that escapes', '/api/events/../venue-photo/' + 'ab'.repeat(32)],
      ['a CSS break-out', `${URL_PATH}"); background: red; (`],
      ['a digest in capitals', URL_PATH.toUpperCase()],
      ['a short digest', '/api/events/camille-et-sacha/venue-photo/abcd'],
    ])('refuses %s, because it is written into a CSS url()', (_name, groundUrl) => {
      expect(themeSurfaceProps(riviera(groundUrl), 'guest')).not.toHaveProperty('style')
    })

    it('is read back from storage only when it is a path this product mints', () => {
      const stored = { accentHue: 305, fonts: 'sans', frame: 'soft', material: 'glass' }

      expect(
        readEventTheme({ ...stored, ambiance: 'guinguette', groundUrl: URL_PATH })?.groundUrl,
      ).toBe(URL_PATH)
      // Anything else is the bundled ground and never a refusal: a decoration must not send a
      // guest back to the join screen mid-evening.
      const odd = readEventTheme({
        ...stored,
        ambiance: 'guinguette',
        groundUrl: 'https://evil.example/x',
      })
      expect(odd).not.toBeNull()
      expect(odd).not.toHaveProperty('groundUrl')
    })
  })

  it('paints the photograph only where the template preview is not', async () => {
    // The preview carries `data-template-preview` and never a photograph, but it is the one
    // place the layer must not be able to leak into, as with every ambiance rule.
    const { default: base } = await import('./base.css?raw')
    const rules = base.match(/[^{}]*\[data-venue-ground='guest'\][^{]*\{/g) ?? []

    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules.filter((candidate) => candidate.includes('::before'))) {
      expect(rule).toContain(':not([data-template-preview])')
    }
  })

  it('empties the root’s bundled ground when a surface carries the host’s own', async () => {
    // Otherwise the bundled photograph is drawn (and downloaded) under the host's, and shows
    // through a photograph with transparency.
    const { default: base } = await import('./base.css?raw')
    const rule = /:root:has\(\[data-venue-ground='guest'\][^{]*\{([^}]*)\}/.exec(base)

    expect(rule?.[1]?.replace(/\s+/g, '')).toBe('background:none;')
  })

  it('keeps the page-wide ambiance selector as light as the surface one', async () => {
    // `:root:has(X)` weighs :root plus X, and a bundler that merges it with the surface
    // selector into `:is()` hands every ambiance element that weight, so it beats the accent
    // and the venue photograph declared after it. `:where()` around X makes it free.
    const { default: tokens } = await import('./tokens.css?raw')
    const heavy = (css: string): string[] =>
      css.match(/:root:has\((?!:where\()[^{,]*data-event-ambiance[^{,]*/g) ?? []

    expect(heavy(tokens)).toEqual([])
    // Known positives: the detector sees the heavy spelling and lets the light one pass.
    expect(heavy(":root:has([data-event-ambiance='champs']:not([x])) {")).toHaveLength(1)
    expect(heavy(":root:has(:where([data-event-ambiance='champs']:not([x]))) {")).toEqual([])
  })

  it('emits no ambiance for the product’s own look', () => {
    expect(themeSurfaceProps(aTheme(), 'wall')).not.toHaveProperty('data-event-ambiance')
    expect(themeSurfaceProps(aTheme(), 'guest')).not.toHaveProperty('data-event-ambiance')
  })

  it('gives the guest the colour and not the typography', () => {
    // The honest scope of the pairing: a display face buys nothing on a screen whose
    // largest type is `--text-lg`, and had the pairings been bundled rather than built
    // from system faces this is the surface that would have paid the bytes.
    const props = themeSurfaceProps(
      aTheme({
        accentHue: 345,
        fonts: 'serif',
        frame: 'round',
        material: 'glass',
        ambiance: 'guinguette',
      }),
      'guest',
    )

    expect(props).toEqual({
      style: { '--accent-hue': '345' },
      'data-event-accent': '345',
    })
  })

  /* ---- The material a host turned off (roadmap 11.5). ---- */

  it.each(['wall', 'guest'] as const)('carries the host’s plain surface onto the %s', (surface) => {
    // Both surfaces the host's look reaches. Not the console: it is one operator's tool
    // across many events, and a toolbar that changes material per event is the screen
    // where consistency beats personality — §12's argument, unchanged by the knob being a
    // surface finish rather than a colour.
    expect(
      themeSurfaceProps(aTheme({ material: 'plain', ambiance: 'guinguette' }), surface),
    ).toEqual({
      'data-glass': 'opaque',
    })
  })

  it.each(['wall', 'guest'] as const)(
    'spreads nothing for a host who kept glass, on the %s',
    (surface) => {
      // The one-way rule at the point it reaches the DOM. A themed surface is a descendant
      // of the shell, where the machine's own answer is declared, and a tier declared on a
      // descendant wins for its subtree — so `data-glass="ground"` here would put a blur
      // back on a projector and on any machine the budget had already taken it from.
      expect(
        themeSurfaceProps(aTheme({ material: 'glass', ambiance: 'guinguette' }), surface),
      ).toEqual({})
    },
  )
})

describe('the picker’s catalogue', () => {
  it('names every hue it offers', () => {
    expect(CURATED_ACCENT_NAMES).toEqual(['violet', 'rose', 'azure', 'teal'])
  })

  it('recognises a stored hue as one of the named ones', () => {
    expect(accentNameFor(CURATED_ACCENT_HUES.rose)).toBe('rose')
  })

  it('recognises no name for an angle set outside the console', () => {
    // The API takes any legible angle, so a stored hue need not be one of the four. The
    // picker shows none of them selected rather than silently claiming the nearest.
    expect(accentNameFor(200)).toBeNull()
  })
})

describe('readEventTheme', () => {
  it('accepts a theme as the server sends it', () => {
    expect(
      readEventTheme({
        accentHue: 345,
        fonts: 'serif',
        frame: 'round',
        material: 'glass',
        ambiance: 'guinguette',
      }),
    ).toEqual({
      accentHue: 345,
      fonts: 'serif',
      frame: 'round',
      material: 'glass',
      ambiance: 'guinguette',
    })
  })

  it.each([
    ['nothing at all', undefined],
    ['a string where the object goes', 'rose'],
    [
      'a hue that is text',
      {
        accentHue: 'rose',
        fonts: 'sans',
        frame: 'soft',
        material: 'glass',
        ambiance: 'guinguette',
      },
    ],
    [
      'a hue that is not a number at all',
      {
        accentHue: Number.NaN,
        fonts: 'sans',
        frame: 'soft',
        material: 'glass',
        ambiance: 'guinguette',
      },
    ],
    [
      'a hue past the circle',
      { accentHue: 4000, fonts: 'sans', frame: 'soft', material: 'glass', ambiance: 'guinguette' },
    ],
    [
      'a negative hue',
      { accentHue: -1, fonts: 'sans', frame: 'soft', material: 'glass', ambiance: 'guinguette' },
    ],
    [
      'a hue between two degrees',
      { accentHue: 305.5, fonts: 'sans', frame: 'soft', material: 'glass', ambiance: 'guinguette' },
    ],
    [
      'a font pairing this build never shipped',
      { accentHue: 305, fonts: 'comic', frame: 'soft', material: 'glass', ambiance: 'guinguette' },
    ],
    [
      'a frame style this build never shipped',
      { accentHue: 305, fonts: 'sans', frame: 'oval', material: 'glass', ambiance: 'guinguette' },
    ],
  ])('refuses %s', (_case, value) => {
    // A hue that is not a number reaches `--accent-hue` as something the browser cannot
    // parse, and the accent — the only colour on the guest's one control — falls over.
    expect(readEventTheme(value)).toBeNull()
  })

  it('fills in the material for an entry written before there was one', () => {
    // A `sessionStorage` entry a guest's tab wrote between roadmap 2.2 and 11.5. Refusing
    // it would send them back to the join screen mid-evening with photos in their queue,
    // to change nothing: `glass` is exactly what that tab has been rendering all along.
    expect(readEventTheme({ accentHue: 345, fonts: 'serif', frame: 'round' })).toEqual({
      accentHue: 345,
      fonts: 'serif',
      frame: 'round',
      material: 'glass',
      ambiance: 'guinguette',
    })
  })

  it('reads a session stored as darkroom, the retired Chambre noire, as the Guinguette', () => {
    // The tab was opened before 28/10: refusing the entry would send the guest back to the door.
    expect(
      readEventTheme({
        accentHue: 305,
        fonts: 'sans',
        frame: 'soft',
        material: 'glass',
        ambiance: 'darkroom',
      })?.ambiance,
    ).toBe('guinguette')
  })

  it('refuses an ambiance this build never shipped rather than filling one in', () => {
    expect(
      readEventTheme({
        accentHue: 305,
        fonts: 'sans',
        frame: 'soft',
        material: 'glass',
        ambiance: 'disco',
      }),
    ).toBeNull()
  })

  it('refuses a material this build never shipped rather than filling one in', () => {
    // Different in kind from the absence above. A value that is present and wrong came
    // from something other than this server, it reaches a CSS attribute selector, and a
    // tier no block matches renders the material the host may have asked to turn off.
    expect(
      readEventTheme({ accentHue: 305, fonts: 'sans', frame: 'soft', material: 'opaque' }),
    ).toBeNull()
  })
})

describe('the host’s own ambiance on a surface (ADR 0011)', () => {
  const custom = { ground: 'dark', groundHue: 200, faces: 'cabaret' } as const
  const worn = aTheme({ ambiance: 'custom', custom })

  it.each(['wall', 'guest'] as const)('emits polarity, faces and an angle on the %s', (surface) => {
    const props = themeSurfaceProps(worn, surface)

    expect(props['data-event-ambiance']).toBe('custom')
    expect(props['data-ambiance-ground']).toBe('dark')
    expect(props['data-ambiance-faces']).toBe('cabaret')
    expect(props.style).toEqual({ '--ground-hue': '200deg' })
  })

  it('shares the style with the accent and the venue photograph', () => {
    const path = `/api/events/camille/venue-photo/${'ab'.repeat(32)}`
    const props = themeSurfaceProps({ ...worn, accentHue: 345, groundUrl: path }, 'wall')

    expect(props.style).toMatchObject({ '--accent-hue': '345', '--ground-hue': '200deg' })
    expect(props.style).toHaveProperty('--ambiance-ground')
    expect(props['data-venue-ground']).toBe('wall')
  })

  it('emits nothing of it for another ambiance', () => {
    const props = themeSurfaceProps(aTheme({ ambiance: 'noces' }), 'wall')

    expect(props).not.toHaveProperty('data-ambiance-ground')
    expect(props).not.toHaveProperty('data-ambiance-faces')
  })

  it('reads the object off the wire, and refuses a custom ambiance without a valid one', () => {
    const base = { ...DEFAULT_EVENT_THEME, ambiance: 'custom' }

    expect(readEventTheme({ ...base, custom })).toEqual({ ...base, custom })
    expect(readEventTheme(base)).toBeNull()
    expect(readEventTheme({ ...base, custom: 'dark' })).toBeNull()
    expect(readEventTheme({ ...base, custom: { ...custom, ground: 'grey' } })).toBeNull()
    expect(readEventTheme({ ...base, custom: { ...custom, faces: 'custom' } })).toBeNull()
    expect(readEventTheme({ ...base, custom: { ...custom, groundHue: '1' } })).toBeNull()
    expect(readEventTheme({ ...base, custom: { ...custom, groundHue: 1.5 } })).toBeNull()
    expect(readEventTheme({ ...base, custom: { ...custom, groundHue: 360 } })).toBeNull()
    expect(readEventTheme({ ...base, custom: { ...custom, groundHue: -1 } })).toBeNull()
  })

  it('drops an object that arrives beside an ambiance that does not wear it', () => {
    expect(readEventTheme({ ...DEFAULT_EVENT_THEME, custom })).toEqual(DEFAULT_EVENT_THEME)
  })
})
