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
    for (const selector of rules) {
      expect(selector).toContain(':not(:has([data-wall-layout]))')
    }
    // The root look has no marker of its own: it is the body that holds no ambiance at all.
    expect(base.replace(/\s+/g, '')).toContain(
      'body:not(:has([data-event-ambiance]:not([data-template-preview]))):not(:has([data-wall-layout]))::before',
    )
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
